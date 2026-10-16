import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageTransfer } from '../packages/storage/src/transfer';

test('large staging hashes incrementally, uses bounded chunks and private files, then cleans up', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-stream-'));
  const chunk = new Uint8Array(65536).fill(42),
    count = 256;
  let produced = 0;
  const checksum = createHash('sha256');
  for (let i = 0; i < count; i++) checksum.update(chunk);
  try {
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (produced++ < count) controller.enqueue(chunk);
          else controller.close();
        },
      },
      { highWaterMark: 1 },
    );
    const stage = await stageTransfer(
      body,
      directory,
      count * chunk.length,
      checksum.digest('hex'),
    );
    expect(stage.size).toBe(16 * 1048576);
    expect(stage.maxChunkBytes).toBeLessThanOrEqual(65536);
    expect(statSync(stage.path).size).toBe(stage.size);
    expect(statSync(stage.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(stage.path, '..')).mode & 0o777).toBe(0o700);
    await stage.dispose();
    expect(readdirSync(directory)).toHaveLength(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('size/checksum mismatches and cancellation remove all private staging', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-stream-errors-'));
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    });
  try {
    await expect(stageTransfer(stream(), directory, 2)).rejects.toMatchObject({
      code: 'UPLOAD_MISMATCH',
    });
    await expect(stageTransfer(stream(), directory, 4)).rejects.toMatchObject({
      code: 'UPLOAD_MISMATCH',
    });
    await expect(stageTransfer(stream(), directory, 3, '0'.repeat(64))).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    });
    await expect(stageTransfer(stream(), directory, 3, 'invalid')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(readdirSync(directory)).toHaveLength(0);
    const abort = new AbortController();
    let cancelled = false;
    const pending = new ReadableStream<Uint8Array>({
      async pull(c) {
        await Bun.sleep(10);
        try {
          c.enqueue(new Uint8Array(65536));
        } catch {}
      },
      cancel() {
        cancelled = true;
      },
    });
    const staging = stageTransfer(pending, directory, 1048576, undefined, abort.signal);
    setTimeout(() => abort.abort(), 20);
    await expect(staging).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
    expect(readdirSync(directory)).toHaveLength(0);
    const empty = await stageTransfer(null, directory, 0);
    expect(empty.checksum).toBe(createHash('sha256').digest('hex'));
    await empty.dispose();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
