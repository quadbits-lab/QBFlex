import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { QBError, type ResumableUploadSession } from '@qb-flex/contracts';

const MAX_LENGTH = 100 * 1024 * 1024;
const SLICE = 64 * 1024;
const TTL_MS = 60 * 60 * 1000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface SessionRecord {
  id: string;
  objectId: string;
  bucketId: string;
  key: string;
  offset: number;
  length: number;
  expiresAt: string;
  ownerId: string;
  finalized: boolean;
  busy: boolean;
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0'))
    throw new QBError('VALIDATION', `Invalid ${label}`);
  return value;
}

function view(session: SessionRecord): ResumableUploadSession {
  return {
    id: session.id,
    objectId: session.objectId,
    bucketId: session.bucketId,
    key: session.key,
    offset: session.offset,
    length: session.length,
    expiresAt: session.expiresAt,
  };
}

/**
 * Offset-checked staged uploads. Session metadata is a JSON file next to the
 * bytes so a restarted owner can resume until the one-hour expiry.
 * Writes are sliced at 64 KiB. The declared length cannot exceed 100 MiB.
 */
export class ResumableUploads {
  private sessions = new Map<string, SessionRecord>();
  constructor(private root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.restore();
  }
  private binPath(id: string) {
    return join(this.root, `${id}.bin`);
  }
  private metaPath(id: string) {
    return join(this.root, `${id}.json`);
  }
  private persist(session: SessionRecord) {
    const { busy: _busy, ...stored } = session;
    writeFileSync(this.metaPath(session.id), JSON.stringify(stored), { mode: 0o600 });
  }
  private remove(id: string) {
    this.sessions.delete(id);
    for (const path of [this.metaPath(id), this.binPath(id)]) {
      try {
        unlinkSync(path);
      } catch {
        // Already gone.
      }
    }
  }
  private restore() {
    let names: string[] = [];
    try {
      names = readdirSync(this.root);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!ID.test(id)) continue;
      try {
        const parsed = JSON.parse(readFileSync(this.metaPath(id), 'utf8')) as Partial<SessionRecord>;
        const length = parsed.length;
        if (
          parsed.id !== id ||
          typeof parsed.objectId !== 'string' ||
          typeof parsed.bucketId !== 'string' ||
          typeof parsed.key !== 'string' ||
          typeof parsed.ownerId !== 'string' ||
          typeof parsed.expiresAt !== 'string' ||
          typeof length !== 'number' ||
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > MAX_LENGTH
        ) {
          this.remove(id);
          continue;
        }
        if (Date.parse(parsed.expiresAt) <= Date.now()) {
          this.remove(id);
          continue;
        }
        const path = this.binPath(id);
        const size = statSync(path).size;
        if (size > length) {
          this.remove(id);
          continue;
        }
        this.sessions.set(id, {
          id,
          objectId: parsed.objectId,
          bucketId: parsed.bucketId,
          key: parsed.key,
          offset: size,
          length,
          expiresAt: parsed.expiresAt,
          ownerId: parsed.ownerId,
          finalized: parsed.finalized === true && size === length,
          busy: false,
        });
      } catch {
        this.remove(id);
      }
    }
  }
  private live(id: string) {
    const session = this.sessions.get(id);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      if (session) this.remove(id);
      throw new QBError('NOT_FOUND', 'Upload session not found', 404);
    }
    return session;
  }
  private async writeSlices(path: string, chunk: Uint8Array) {
    const handle = await open(path, 'a');
    try {
      for (let index = 0; index < chunk.byteLength; index += SLICE) {
        const slice = chunk.subarray(index, Math.min(index + SLICE, chunk.byteLength));
        let written = 0;
        while (written < slice.byteLength) {
          const result = await handle.write(slice.subarray(written));
          if (result.bytesWritten <= 0)
            throw new QBError('STORAGE_UNAVAILABLE', 'Unable to stage upload bytes', 503, true);
          written += result.bytesWritten;
        }
      }
    } finally {
      await handle.close();
    }
  }
  async createSession(input: {
    objectId: string;
    bucketId: string;
    key: string;
    length: number;
    ownerId: string;
  }): Promise<ResumableUploadSession> {
    this.expire();
    const objectId = text(input?.objectId, 'object id', 200);
    const bucketId = text(input?.bucketId, 'bucket id', 200);
    const key = text(input?.key, 'object key', 1024);
    const ownerId = text(input?.ownerId, 'owner id', 200);
    if (!Number.isSafeInteger(input.length) || input.length < 0)
      throw new QBError('VALIDATION', 'Upload length must be a non-negative integer');
    if (input.length > MAX_LENGTH)
      throw new QBError('SIZE_LIMIT', 'Upload length exceeds 100 MiB', 413);
    const id = randomUUID();
    const session: SessionRecord = {
      id,
      objectId,
      bucketId,
      key,
      offset: 0,
      length: input.length,
      expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
      ownerId,
      finalized: false,
      busy: false,
    };
    writeFileSync(this.binPath(id), new Uint8Array(), { mode: 0o600, flag: 'wx' });
    this.persist(session);
    this.sessions.set(id, session);
    return view(session);
  }
  offset(id: string) {
    return this.live(id).offset;
  }
  session(id: string): ResumableUploadSession {
    return view(this.live(id));
  }
  async append(id: string, chunk: Uint8Array, expectedOffset: number) {
    const session = this.live(id);
    if (session.busy) throw new QBError('UPLOAD_BUSY', 'Upload is already receiving a chunk', 409);
    if (session.finalized) throw new QBError('VALIDATION', 'Upload is already finalized');
    if (!Number.isSafeInteger(expectedOffset) || session.offset !== expectedOffset)
      throw new QBError('OFFSET_MISMATCH', 'Upload offset does not match', 409);
    if (!(chunk instanceof Uint8Array)) throw new QBError('VALIDATION', 'Chunk must be bytes');
    if (chunk.byteLength > session.length - session.offset)
      throw new QBError('UPLOAD_MISMATCH', 'Chunk exceeds the declared upload length', 409);
    session.busy = true;
    try {
      if (chunk.byteLength > 0) await this.writeSlices(this.binPath(id), chunk);
      session.offset += chunk.byteLength;
      this.persist(session);
      return session.offset;
    } finally {
      session.busy = false;
    }
  }
  async finalize(id: string) {
    const session = this.live(id);
    if (session.busy) throw new QBError('UPLOAD_BUSY', 'Upload is already receiving a chunk', 409);
    if (session.offset !== session.length)
      throw new QBError('UPLOAD_INCOMPLETE', 'Upload has not reached the declared length', 409);
    const size = statSync(this.binPath(id)).size;
    if (size !== session.length)
      throw new QBError('UPLOAD_MISMATCH', 'Staged upload size does not match', 409);
    session.finalized = true;
    this.persist(session);
    return this.binPath(id);
  }
  abort(id: string) {
    if (!this.sessions.has(id)) throw new QBError('NOT_FOUND', 'Upload session not found', 404);
    const session = this.sessions.get(id)!;
    if (session.busy) throw new QBError('UPLOAD_BUSY', 'Upload is already receiving a chunk', 409);
    this.remove(id);
  }
  /** Drops sessions whose one-hour lifetime has passed, including their staged bytes. */
  expire(now = Date.now()) {
    let removed = 0;
    for (const session of this.sessions.values()) {
      if (Date.parse(session.expiresAt) <= now) {
        this.remove(session.id);
        removed++;
      }
    }
    return removed;
  }
}
