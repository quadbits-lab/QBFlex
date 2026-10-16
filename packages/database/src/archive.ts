import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, rename, rm, appendFile } from 'node:fs/promises';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { QBError } from '@qb-flex/contracts';
import { dirname } from 'node:path';

const magic = Buffer.from('QBFARCH2\n');
const headerLimit = 4096;
const corrupt = () =>
  new QBError('BACKUP_CORRUPT', 'Archive authentication or checksum validation failed', 409);
interface Options {
  engine?: { name: 'pglite'; version: string };
  signal?: AbortSignal;
  maxBytes?: number;
  kind?: 'control';
  metadata?: { kind: 'control'; checksum: string; createdAt: string };
}
function hashStream(expectedSize: number, maxBytes: number, legacy = false) {
  const hash = createHash('sha256');
  let size = 0,
    carry = Buffer.alloc(0);
  const stream = new Transform({
    highWaterMark: 65536,
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes || size > expectedSize) return callback(corrupt());
      if (!legacy) hash.update(chunk);
      else {
        const combined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        const end = combined.length - (combined.length % 3);
        hash.update(combined.subarray(0, end).toString('base64'));
        carry = Buffer.from(combined.subarray(end));
      }
      callback(null, chunk);
    },
  });
  return {
    stream,
    digest() {
      if (size !== expectedSize) throw corrupt();
      if (legacy && carry.length) hash.update(carry.toString('base64'));
      return hash.digest('hex');
    },
  };
}
async function durableFile(path: string) {
  const file = await open(path, 'r+');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function durableRename(source: string, destination: string) {
  await rename(source, destination);
  const directory = await open(dirname(destination), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function readExactly(file: Awaited<ReturnType<typeof open>>, size: number, position: number) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const read = await file.read(buffer, offset, size - offset, position + offset);
    if (!read.bytesRead) throw corrupt();
    offset += read.bytesRead;
  }
  return buffer;
}

/** V2: magic | header-length(u32be) | authenticated JSON header | iv12 | ciphertext | tag16. */
export async function encryptArchive(
  source: string,
  destination: string,
  key: Uint8Array,
  options: Options = {},
) {
  const size = (await stat(source)).size,
    maximum = options.maxBytes ?? 1073741824;
  if (key.length !== 32 || !Number.isSafeInteger(size) || size > maximum) throw corrupt();
  if (
    options.metadata &&
    (options.metadata.kind !== 'control' ||
      !/^sha256:[a-f0-9]{64}$/.test(options.metadata.checksum) ||
      !Number.isFinite(Date.parse(options.metadata.createdAt)))
  )
    throw corrupt();
  const metadata = Buffer.from(
    JSON.stringify({
      format: 2,
      ...(options.engine ? { engine: options.engine } : {}),
      size,
      algorithm: 'aes-256-gcm',
      ...(options.metadata
        ? {
            kind: 'control',
            checksum: options.metadata.checksum,
            createdAt: options.metadata.createdAt,
          }
        : {}),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  const aad = Buffer.concat([magic, length, metadata]),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const hash = hashStream(size, maximum);
  const temporary = destination + '.partial-' + crypto.randomUUID();
  try {
    const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600, highWaterMark: 65536 });
    output.write(Buffer.concat([aad, iv]));
    await pipeline(
      createReadStream(source, { highWaterMark: 65536 }),
      hash.stream,
      cipher,
      output,
      { signal: options.signal },
    );
    const checksum = 'sha256:' + hash.digest();
    if (options.metadata && checksum !== options.metadata.checksum) throw corrupt();
    await appendFile(temporary, cipher.getAuthTag());
    await durableFile(temporary);
    options.signal?.throwIfAborted();
    await durableRename(temporary, destination);
    return { format: 2 as const, size, checksum };
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Restores legacy iv/ciphertext/tag archives too, including the legacy base64-text checksum. */
export async function decryptArchive(
  source: string,
  destination: string,
  key: Uint8Array,
  checksum: string | null,
  options: Options = {},
) {
  const file = await open(source, 'r');
  const temporary = destination + '.partial-' + crypto.randomUUID();
  try {
    const total = (await file.stat()).size,
      maximum = options.maxBytes ?? 1073741824;
    if (total < 28 || key.length !== 32) throw corrupt();
    const first = await readExactly(file, magic.length, 0);
    const version2 = first.equals(magic);
    let start = 12,
      expectedSize = total - 28,
      aad: Buffer | undefined,
      iv: Buffer;
    if (version2) {
      const length = (await readExactly(file, 4, magic.length)).readUInt32BE();
      if (length < 2 || length > headerLimit || total < magic.length + 4 + length + 28)
        throw corrupt();
      aad = await readExactly(file, magic.length + 4 + length, 0);
      const metadata = JSON.parse(aad.subarray(magic.length + 4).toString());
      if (
        metadata.format !== 2 ||
        metadata.algorithm !== 'aes-256-gcm' ||
        !Number.isSafeInteger(metadata.size) ||
        metadata.size < 0
      )
        throw corrupt();
      if (
        metadata.engine &&
        (metadata.engine.name !== 'pglite' || metadata.engine.version !== '0.5.10')
      )
        throw new QBError('BACKUP_ENGINE', 'Snapshot requires a compatible PGlite runtime', 409);
      expectedSize = metadata.size;
      start = aad.length + 12;
      if (options.kind === 'control') {
        if (
          metadata.kind !== 'control' ||
          typeof metadata.checksum !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/.test(metadata.checksum) ||
          typeof metadata.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(metadata.createdAt)) ||
          (checksum !== null && checksum !== metadata.checksum)
        )
          throw corrupt();
        checksum = metadata.checksum;
      } else if (metadata.kind !== undefined) throw corrupt();
      if (
        expectedSize !== total - start - 16 ||
        !checksum ||
        !/^sha256:[a-f0-9]{64}$/.test(checksum)
      )
        throw corrupt();
      iv = await readExactly(file, 12, aad.length);
    } else {
      if (options.kind || !checksum || !/^[a-f0-9]{64}$/.test(checksum)) throw corrupt();
      iv = await readExactly(file, 12, 0);
    }
    if (expectedSize > maximum) throw corrupt();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(await readExactly(file, 16, total - 16));
    const hash = hashStream(expectedSize, maximum, !version2);
    // Unauthenticated plaintext exists only in this private, unpublished staging file.
    const encrypted =
      expectedSize === 0
        ? Readable.from([])
        : createReadStream(source, { start, end: total - 17, highWaterMark: 65536 });
    await pipeline(
      encrypted,
      decipher,
      hash.stream,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600, highWaterMark: 65536 }),
      { signal: options.signal },
    );
    const actual = (version2 ? 'sha256:' : '') + hash.digest();
    if (actual !== checksum) throw corrupt();
    await durableFile(temporary);
    options.signal?.throwIfAborted();
    await durableRename(temporary, destination);
    return { format: version2 ? 2 : 1, size: expectedSize };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw corrupt();
  } finally {
    await file.close();
    await rm(temporary, { force: true });
  }
}
