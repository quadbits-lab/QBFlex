import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { QBError } from '@qb-flex/contracts';
export class ObjectBackend {
  private client: S3Client;
  private bucket: string;
  constructor() {
    this.bucket = process.env.QB_S3_BUCKET ?? 'qb-flex';
    this.client = new S3Client({
      endpoint: process.env.QB_S3_ENDPOINT,
      region: process.env.QB_S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
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
}
