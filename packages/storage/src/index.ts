import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
} from '@aws-sdk/client-s3';
import {
  existsSync,
  createReadStream,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { QBError } from '@qb-flex/contracts';
/**
 * Inside Docker, loopback cannot reach services published from the host; rewrite a
 * local S3 endpoint to the host gateway so one QB_S3_ENDPOINT value works natively and
 * containerized. Native (non-container) processes keep the endpoint unchanged.
 */
export function resolveS3Endpoint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!existsSync('/.dockerenv')) return raw;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(raw)) return raw;
  return raw.replace(/(localhost|127\.0\.0\.1)/, 'host.docker.internal');
}
export class ObjectBackend {
  private client: S3Client;
  private bucket: string;
  constructor() {
    this.bucket = process.env.QB_S3_BUCKET ?? 'qb-flex';
    this.client = new S3Client({
      endpoint: resolveS3Endpoint(process.env.QB_S3_ENDPOINT),
      region: process.env.QB_S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: process.env.QB_S3_ACCESS_KEY
        ? {
            accessKeyId: process.env.QB_S3_ACCESS_KEY,
            secretAccessKey: process.env.QB_S3_SECRET_KEY!,
          }
        : undefined,
    });
  }
  check() {
    if (
      !process.env.QB_S3_ENDPOINT ||
      !process.env.QB_S3_ACCESS_KEY ||
      !process.env.QB_S3_SECRET_KEY
    )
      throw new QBError(
        'STORAGE_UNCONFIGURED',
        'Configure the S3 backend before using storage',
        503,
        true,
      );
  }
  async put(key: string, body: Uint8Array, size: number, mime: string) {
    this.check();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: mime,
      }),
    );
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (head.ContentLength !== size)
      throw new QBError('UPLOAD_MISMATCH', 'Uploaded object size does not match', 409);
    return { etag: head.ETag };
  }
  async putFile(key: string, path: string, size: number, mime: string, signal?: AbortSignal) {
    this.check();
    const body = createReadStream(path, { highWaterMark: 65536 });
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: mime,
        }),
        { abortSignal: signal },
      );
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal },
      );
      if (head.ContentLength !== size)
        throw new QBError('UPLOAD_MISMATCH', 'Uploaded object size does not match', 409);
      return { etag: head.ETag };
    } finally {
      body.destroy();
    }
  }
  async get(key: string) {
    this.check();
    const obj = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      body: obj.Body!.transformToWebStream(),
      size: obj.ContentLength,
      mime: obj.ContentType,
    };
  }
  async delete(key: string) {
    this.check();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async head(key: string, signal?: AbortSignal) {
    this.check();
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: signal },
    );
    return { size: head.ContentLength ?? 0, etag: head.ETag ?? null };
  }
  async versioningEnabled(signal?: AbortSignal) {
    this.check();
    const result = await this.client.send(
      new GetBucketVersioningCommand({ Bucket: this.bucket }),
      { abortSignal: signal },
    );
    return result.Status === 'Enabled';
  }
}

export type DestinationCredentials = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Off-node recovery destination. Separate from application object storage credentials. */
export class DestinationBackend {
  private client: S3Client | null;
  private localRoot: string | null;
  private bucket: string;
  constructor(
    credentials: DestinationCredentials,
    options: { localRoot?: string } = {},
  ) {
    this.bucket = credentials.bucket;
    if (options.localRoot) {
      this.client = null;
      this.localRoot = options.localRoot;
      mkdirSync(join(options.localRoot, credentials.bucket), { recursive: true, mode: 0o700 });
      return;
    }
    this.localRoot = null;
    this.client = new S3Client({
      endpoint: resolveS3Endpoint(credentials.endpoint),
      region: credentials.region || 'us-east-1',
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
    });
  }
  private localPath(key: string) {
    if (!this.localRoot) throw new QBError('STORAGE_UNCONFIGURED', 'Local recovery store missing');
    return join(this.localRoot, this.bucket, key);
  }
  async putFile(key: string, path: string, size: number, mime: string, signal?: AbortSignal) {
    if (this.localRoot) {
      signal?.throwIfAborted();
      const target = this.localPath(key);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(path, target);
      writeFileSync(target + '.meta', JSON.stringify({ size, mime }), { mode: 0o600 });
      if (statSync(target).size !== size)
        throw new QBError('UPLOAD_MISMATCH', 'Uploaded object size does not match', 409);
      return { etag: '"local"' };
    }
    const body = createReadStream(path, { highWaterMark: 65536 });
    try {
      await this.client!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: mime,
        }),
        { abortSignal: signal },
      );
      const head = await this.client!.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal },
      );
      if (head.ContentLength !== size)
        throw new QBError('UPLOAD_MISMATCH', 'Uploaded object size does not match', 409);
      return { etag: head.ETag };
    } finally {
      body.destroy();
    }
  }
  async head(key: string, signal?: AbortSignal) {
    if (this.localRoot) {
      signal?.throwIfAborted();
      const target = this.localPath(key);
      if (!existsSync(target)) throw new QBError('NOT_FOUND', 'Object not found', 404);
      return { size: statSync(target).size, etag: '"local"' as string | null };
    }
    const head = await this.client!.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: signal },
    );
    return { size: head.ContentLength ?? 0, etag: head.ETag ?? null };
  }
  async delete(key: string) {
    if (this.localRoot) {
      const target = this.localPath(key);
      unlinkSync(target);
      if (existsSync(target + '.meta')) unlinkSync(target + '.meta');
      return;
    }
    await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async versioningEnabled(signal?: AbortSignal) {
    if (this.localRoot) {
      signal?.throwIfAborted();
      const marker = join(this.localRoot, this.bucket, '.versioning');
      return existsSync(marker) && readFileSync(marker, 'utf8').trim() === 'Enabled';
    }
    const result = await this.client!.send(
      new GetBucketVersioningCommand({ Bucket: this.bucket }),
      { abortSignal: signal },
    );
    return result.Status === 'Enabled';
  }
}

/** Test and local-only destination host. Production operators use real S3-compatible HTTPS endpoints. */
export const RECOVERY_TEST_HOST = 'recovery.test';
export function isRecoveryTestEndpoint(endpoint: string) {
  try {
    return new URL(endpoint).hostname === RECOVERY_TEST_HOST;
  } catch {
    return false;
  }
}
