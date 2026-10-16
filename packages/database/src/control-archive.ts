import { createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, rename, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import { realmSecret } from '@qb-flex/auth';
import { QBError } from '@qb-flex/contracts';
import { decryptArchive, encryptArchive } from './archive';

export interface ControlArchiveOptions {
  signal?: AbortSignal;
  maxBytes?: number;
}
const corrupt = () =>
  new QBError('BACKUP_CORRUPT', 'Control snapshot integrity validation failed', 409);
const maximum = (options: ControlArchiveOptions) => {
  const value = options.maxBytes ?? 1073741824;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new QBError('VALIDATION', 'Invalid control archive byte limit');
  return value;
};
// Same domain/key as legacy encryption(realmSecret(master, 'control-backups')).
const keyFor = (master: string) =>
  Buffer.from(realmSecret(realmSecret(master, 'control-backups'), 'encryption'), 'hex');

export async function encryptControlArchive(
  source: string,
  destination: string,
  master: string,
  options: ControlArchiveOptions = {},
) {
  options.signal?.throwIfAborted();
  const size = (await stat(source)).size;
  if (size > maximum(options))
    throw new QBError('SIZE_LIMIT', 'Control snapshot exceeds archive limit', 413);
  // Hash the immutable engine snapshot in bounded chunks; include the digest inside authenticated AAD.
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(source, {
    highWaterMark: 65536,
    signal: options.signal,
  }))
    hash.update(chunk);
  const metadata = {
    kind: 'control' as const,
    checksum: 'sha256:' + hash.digest('hex'),
    createdAt: new Date().toISOString(),
  };
  return encryptArchive(source, destination, keyFor(master), {
    ...options,
    metadata,
    ...(source.endsWith('.tar') ? { engine: { name: 'pglite' as const, version: '0.5.10' } } : {}),
  });
}

/** Strict incremental decoder: canonical encoding only, at most seven carried characters. */
function base64Decoder(url: boolean) {
  let carry = '';
  const encoding = url ? 'base64url' : 'base64';
  const characters = url ? /^[A-Za-z0-9_-]*$/ : /^[A-Za-z0-9+/]*$/;
  const decode = (text: string) => {
    const bytes = Buffer.from(text, encoding);
    if (bytes.toString(encoding) !== text) throw corrupt();
    return bytes;
  };
  return new Transform({
    highWaterMark: 65536,
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const text = carry + chunk.toString('latin1');
        const end = Math.max(0, Math.floor(text.length / 4) * 4 - 4);
        const complete = text.slice(0, end);
        if (!characters.test(complete)) throw corrupt();
        carry = text.slice(end);
        callback(null, decode(complete));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        if (
          url
            ? !characters.test(carry) || carry.length % 4 === 1
            : !/^[A-Za-z0-9+/]*={0,2}$/.test(carry) || carry.length % 4 !== 0
        )
          throw corrupt();
        callback(null, decode(carry));
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/** Parse only the legacy envelope emitted by JSON.stringify({format,createdAt,checksum,data}). */
function legacyEnvelope() {
  let prefix = '',
    suffix = '',
    inData = false,
    finished = false;
  let expectedChecksum: string | undefined;
  const stream = new Transform({
    highWaterMark: 65536,
    transform(chunk: Buffer, _encoding, callback) {
      try {
        let text = chunk.toString('latin1');
        if (!inData) {
          prefix += text;
          const marker = /"data"\s*:\s*"/.exec(prefix);
          if (!marker) {
            if (prefix.length > 4096) throw corrupt();
            return callback();
          }
          const start = marker.index + marker[0].length;
          if (start > 4096) throw corrupt();
          const meta = JSON.parse(prefix.slice(0, start) + '"}');
          if (
            meta.format !== 1 ||
            typeof meta.checksum !== 'string' ||
            !/^[a-f0-9]{64}$/.test(meta.checksum) ||
            typeof meta.createdAt !== 'string' ||
            !Number.isFinite(Date.parse(meta.createdAt)) ||
            Object.keys(meta).sort().join(',') !== 'checksum,createdAt,data,format'
          )
            throw corrupt();
          expectedChecksum = meta.checksum;
          text = prefix.slice(start);
          prefix = '';
          inData = true;
        }
        if (finished) suffix += text;
        else {
          const end = text.indexOf('"');
          if (end < 0) this.push(Buffer.from(text, 'latin1'));
          else {
            this.push(Buffer.from(text.slice(0, end), 'latin1'));
            suffix = text.slice(end);
            finished = true;
          }
        }
        if (suffix.length > 4096) throw corrupt();
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      if (!finished || suffix.trim() !== '"}') callback(corrupt());
      else callback();
    },
  });
  return { stream, checksum: () => expectedChecksum };
}

export async function decryptControlArchive(
  source: string,
  destination: string,
  master: string,
  options: ControlArchiveOptions = {},
) {
  options.signal?.throwIfAborted();
  const file = await open(source, 'r');
  let header: Buffer, total: number;
  try {
    total = (await file.stat()).size;
    header = Buffer.alloc(40);
    let offset = 0;
    while (offset < header.length) {
      const { bytesRead } = await file.read(header, offset, header.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    header = header.subarray(0, offset);
  } finally {
    await file.close();
  }
  if (header.subarray(0, 9).toString() === 'QBFARCH2\n')
    return decryptArchive(source, destination, keyFor(master), null, {
      ...options,
      kind: 'control',
    });
  // Legacy: base64url(iv12).base64url(tag16).base64url(encrypted JSON with base64 database).
  const match = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.$/.exec(header.toString('latin1'));
  if (!match || total > Math.ceil((maximum(options) * 16) / 9) + 8192) throw corrupt();
  if (Buffer.from(match[2]!, 'base64url').toString('base64url') !== match[2]) throw corrupt();
  const temporary = destination + '.partial-' + crypto.randomUUID();
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(master),
      Buffer.from(match[1]!, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(match[2]!, 'base64url'));
    const envelope = legacyEnvelope(),
      hash = createHash('sha256');
    let size = 0;
    const boundedHash = new Transform({
      highWaterMark: 65536,
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maximum(options)) return callback(corrupt());
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      createReadStream(source, { start: 40, highWaterMark: 65536 }),
      base64Decoder(true),
      decipher,
      envelope.stream,
      base64Decoder(false),
      boundedHash,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600, highWaterMark: 65536 }),
      { signal: options.signal },
    );
    if (hash.digest('hex') !== envelope.checksum()) throw corrupt();
    const staged = await open(temporary, 'r+');
    try {
      await staged.sync();
    } finally {
      await staged.close();
    }
    options.signal?.throwIfAborted();
    await rename(temporary, destination);
    const directory = await open(dirname(destination), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return { format: 1, size };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw corrupt();
  } finally {
    await rm(temporary, { force: true });
  }
}
