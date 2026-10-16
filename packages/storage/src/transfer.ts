import { createHash } from 'node:crypto';
import { createWriteStream, statfsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { QBError } from '@qb-flex/contracts';

/** Private disk staging validates bytes before any S3 PUT. Memory is chunk-bounded. */
export async function stageTransfer(
  body: ReadableStream<Uint8Array> | null,
  directory: string,
  expectedSize: number,
  expectedChecksum?: string | null,
  signal?: AbortSignal,
) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > 104857600)
    throw new QBError('SIZE_LIMIT', 'Transfer size exceeds 100 MiB', 413);
  if (expectedChecksum && !/^[a-f0-9]{64}$/.test(expectedChecksum))
    throw new QBError('VALIDATION', 'Expected checksum must be lowercase SHA-256');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const disk = statfsSync(directory);
  if (disk.bavail * disk.bsize < expectedSize + 67108864)
    throw new QBError(
      'DISK_PRESSURE',
      'Insufficient space for private transfer staging',
      503,
      true,
    );
  const folder = await mkdtemp(join(directory, 'transfer-'));
  const path = join(folder, 'content');
  const hash = createHash('sha256');
  let size = 0,
    maxChunkBytes = 0;
  const validate = new Transform({
    highWaterMark: 65536,
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      maxChunkBytes = Math.max(maxChunkBytes, chunk.byteLength);
      if (size > expectedSize)
        return callback(new QBError('UPLOAD_MISMATCH', 'File size exceeds intent', 409));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      body ? Readable.fromWeb(body as any, { highWaterMark: 65536 }) : Readable.from([]),
      validate,
      createWriteStream(path, { flags: 'wx', mode: 0o600, highWaterMark: 65536 }),
      { signal },
    );
    if (size !== expectedSize)
      throw new QBError('UPLOAD_MISMATCH', 'File size does not match intent', 409);
    const checksum = hash.digest('hex');
    if (expectedChecksum && expectedChecksum !== checksum)
      throw new QBError('CHECKSUM_MISMATCH', 'File checksum does not match intent', 409);
    return {
      path,
      size,
      checksum,
      maxChunkBytes,
      dispose: () => rm(folder, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}
