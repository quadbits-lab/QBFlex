import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResumableUploads } from '../packages/storage/src/resumable';

function directory() {
  return mkdtempSync(join(tmpdir(), 'qb-resumable-'));
}

test('resumable uploads append at the expected offset and finalize the staged file', async () => {
  const root = directory();
  try {
    const uploads = new ResumableUploads(root);
    const session = await uploads.createSession({
      objectId: 'object-1',
      bucketId: 'bucket-1',
      key: 'photos/cat.bin',
      length: 6,
      ownerId: 'alice',
    });
    expect(session.offset).toBe(0);
    expect(Date.parse(session.expiresAt) - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    await expect(uploads.append(session.id, new Uint8Array([9]), 4)).rejects.toThrow(
      'offset does not match',
    );
    const chunk = new Uint8Array(70_000);
    chunk.set([1, 2, 3, 4], 0);
    chunk[69999] = 7;
    await expect(
      uploads.append(session.id, chunk.subarray(0, 6), 0),
    ).resolves.toBe(6);
    const resumed = new ResumableUploads(root);
    expect(resumed.offset(session.id)).toBe(6);
    const path = await resumed.finalize(session.id);
    expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3, 4, chunk[4], chunk[5]]));
    expect(statSync(path).size).toBe(6);
    await expect(resumed.append(session.id, new Uint8Array([1]), 6)).rejects.toThrow('finalized');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resumable uploads reject a concurrent chunk, abort, expire, and enforce 100 MiB', async () => {
  const root = directory();
  try {
    const uploads = new ResumableUploads(root);
    await expect(
      uploads.createSession({
        objectId: 'object-1',
        bucketId: 'bucket-1',
        key: 'big.bin',
        length: 100 * 1024 * 1024 + 1,
        ownerId: 'alice',
      }),
    ).rejects.toThrow('100 MiB');
    const session = await uploads.createSession({
      objectId: 'object-1',
      bucketId: 'bucket-1',
      key: 'notes.bin',
      length: 4,
      ownerId: 'alice',
    });
    const first = uploads.append(session.id, new Uint8Array([1, 2]), 0);
    await expect(uploads.append(session.id, new Uint8Array([3]), 2)).rejects.toThrow(
      'already receiving',
    );
    expect(await first).toBe(2);
    expect(uploads.offset(session.id)).toBe(2);
    await expect(uploads.finalize(session.id)).rejects.toThrow('has not reached');
    uploads.abort(session.id);
    expect(() => uploads.offset(session.id)).toThrow('not found');
    const wide = new Uint8Array(70_000);
    wide[0] = 9;
    wide[65536] = 8;
    wide[69999] = 7;
    const staged = await uploads.createSession({
      objectId: 'object-3',
      bucketId: 'bucket-1',
      key: 'wide.bin',
      length: wide.byteLength,
      ownerId: 'alice',
    });
    expect(await uploads.append(staged.id, wide, 0)).toBe(wide.byteLength);
    const stagedPath = await uploads.finalize(staged.id);
    expect(readFileSync(stagedPath)).toEqual(Buffer.from(wide));
    const abandoned = await uploads.createSession({
      objectId: 'object-2',
      bucketId: 'bucket-1',
      key: 'gone.bin',
      length: 1,
      ownerId: 'alice',
    });
    expect(uploads.expire(Date.parse(abandoned.expiresAt))).toBeGreaterThanOrEqual(1);
    expect(() => uploads.offset(abandoned.id)).toThrow('not found');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
