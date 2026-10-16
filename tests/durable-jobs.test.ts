import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryption } from '@qb-flex/auth';
import { DurableJobs } from '../packages/database/src/jobs';
const cipher = encryption('isolated-jobs-test-master-key-32-characters');
async function harness() {
  const db = new Database(':memory:');
  await db.exec('');
  let time = 1000000;
  return {
    db,
    jobs: await new DurableJobs(db, cipher, () => time).initialize(),
    advance: (ms: number) => (time += ms),
  };
}
const submission = {
  kind: 'webhook.delivery' as const,
  eventId: 'event-1',
  deduplicationKey: 'submission-1',
  payload: { secret: 'not-plaintext', resource: 'tasks' },
};
test('job submissions are encrypted, deduplicated, bounded and transactional with source work', async () => {
  const { db, jobs, advance } = await harness();
  try {
    const first = await jobs.submit(submission);
    advance(4000);
    expect((await jobs.submit(submission)).id).toBe(first.id);
    await expect(
      (async () => await jobs.submit({ ...submission, payload: { different: true } }))(),
    ).rejects.toThrow('different content');
    expect(((await db.query('SELECT payload FROM _qb_jobs').get()) as any).payload).not.toContain(
      'not-plaintext',
    );
    expect(JSON.stringify(await jobs.list())).not.toMatch(/payload|leaseToken|not-plaintext|dedup/);
    await expect(
      (async () =>
        await jobs.submit({
          ...submission,
          deduplicationKey: 'huge',
          payload: 'x'.repeat(65537),
        }))(),
    ).rejects.toThrow('64 KiB');
    await expect((async () => await jobs.list({ limit: 501 }))()).rejects.toThrow();
    await expect(
      (async () =>
        await db
          .transaction(async () => {
            await jobs.submit({ ...submission, deduplicationKey: 'rollback' });
            throw new Error('rollback');
          })
          .immediate())(),
    ).rejects.toThrow();
    expect(await jobs.list()).toHaveLength(1);
  } finally {
    await db.close();
  }
});
test('expired leases fence late completions; retries and cancellation have recorded attempts', async () => {
  const { db, jobs, advance } = await harness();
  try {
    const job = await jobs.submit(submission);
    const first = (await jobs.claim(['webhook.delivery'], 1000))!;
    expect(first.payload).toEqual(submission.payload);
    expect(await jobs.claim(['webhook.delivery'])).toBeNull();
    advance(1000);
    await expect(
      (async () =>
        await jobs.finish(job.id, first.leaseToken, { success: true }, ['webhook.delivery']))(),
    ).rejects.toThrow('lease no longer valid');
    const second = (await jobs.claim(['webhook.delivery']))!;
    expect(second.attempts).toBe(2);
    await expect(
      (async () =>
        await jobs.finish(job.id, first.leaseToken, { success: true }, ['webhook.delivery']))(),
    ).rejects.toThrow();
    expect(
      (
        await jobs.finish(
          job.id,
          second.leaseToken,
          { success: false, retryable: true, code: 'TIMEOUT' },
          ['webhook.delivery'],
        )
      ).state,
    ).toBe('retry_wait');
    expect(await jobs.claim(['webhook.delivery'])).toBeNull();
    advance(2000);
    const third = (await jobs.claim(['webhook.delivery']))!;
    expect((await jobs.cancel(job.id)).state).toBe('cancelled');
    await expect(
      (async () =>
        await jobs.finish(job.id, third.leaseToken, { success: true }, ['webhook.delivery']))(),
    ).rejects.toThrow();
    expect((await jobs.attempts(job.id)).map((a) => a.outcome)).toEqual([
      'lease_expired',
      'retry_wait',
      'cancelled',
    ]);
  } finally {
    await db.close();
  }
});
test('executor kinds cannot claim or complete push work; six attempts exhaust push policy', async () => {
  const { db, jobs, advance } = await harness();
  try {
    const job = await jobs.submit({ ...submission, kind: 'push.dispatch' });
    expect(await jobs.claim(['maintenance', 'webhook.delivery'])).toBeNull();
    for (let attempt = 1; attempt <= 6; attempt++) {
      const claimed = (await jobs.claim(['push.dispatch']))!;
      expect(claimed.attempts).toBe(attempt);
      await expect(
        (async () =>
          await jobs.finish(job.id, claimed.leaseToken, { success: true }, ['maintenance']))(),
      ).rejects.toThrow('cannot complete');
      await expect(
        (async () =>
          await jobs.finish(
            job.id,
            claimed.leaseToken,
            { success: false, code: 'http://secret/token' },
            ['push.dispatch'],
          ))(),
      ).rejects.toThrow('diagnostic');
      const finished = await jobs.finish(
        job.id,
        claimed.leaseToken,
        { success: false, retryable: true, code: 'PROVIDER_UNAVAILABLE' },
        ['push.dispatch'],
      );
      expect(finished.state).toBe(attempt === 6 ? 'dead' : 'retry_wait');
      advance(60000);
    }
    const replay = await jobs.replay(job.id, 'explicit-request');
    expect(replay.parentId).toBe(job.id);
    expect(replay.eventId).toBe(job.eventId);
    expect((await jobs.replay(job.id, 'explicit-request')).id).toBe(replay.id);
    await expect((async () => await jobs.replay(replay.id, 'bad'))()).rejects.toThrow('Only dead');
  } finally {
    await db.close();
  }
});
test('deadline and exact 30-day retention cleanup are deterministic', async () => {
  const { db, jobs, advance } = await harness();
  try {
    const job = await jobs.submit(submission);
    advance(86400000);
    expect(await jobs.claim(['webhook.delivery'])).toBeNull();
    expect((await jobs.get(job.id)).state).toBe('dead');
    advance(30 * 86400000 - 1);
    expect(await jobs.cleanup()).toBe(0);
    advance(1);
    expect(await jobs.cleanup()).toBe(1);
    expect(await jobs.list()).toHaveLength(0);
  } finally {
    await db.close();
  }
});
test('integer-safe owners emit numeric metadata and ciphertext corruption cannot poison the queue forever', async () => {
  const db = new Database(':memory:', { safeIntegers: true });
  try {
    let time = 1000000;
    const jobs = await new DurableJobs(db, cipher, () => time).initialize();
    const first = await jobs.submit(submission);
    expect(typeof first.createdAt).toBe('number');
    await db.query('UPDATE _qb_jobs SET payload=? WHERE id=?').run('corrupted', first.id);
    time++;
    const next = await jobs.submit({ ...submission, deduplicationKey: 'next' });
    expect(await jobs.claim(['webhook.delivery'])).toBeNull();
    expect((await jobs.get(first.id)).lastCode).toBe('PAYLOAD_INTEGRITY');
    const claim = (await jobs.claim(['webhook.delivery']))!;
    expect(claim.id).toBe(next.id);
    expect(
      (await jobs.finish(next.id, claim.leaseToken, { success: true }, ['webhook.delivery'])).state,
    ).toBe('succeeded');
    expect(typeof (await jobs.attempts(next.id))[0]!.startedAt).toBe('number');
  } finally {
    await db.close();
  }
});
test('committed jobs survive database reopen and expired executor crash', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-jobs-'));
  let time = 1000000;
  let db = new Database(join(directory, 'jobs.pglite'));
  try {
    await db.exec('');
    let jobs = await new DurableJobs(db, cipher, () => time).initialize();
    const job = await jobs.submit(submission),
      claim = (await jobs.claim(['webhook.delivery'], 1000))!;
    await db.close();
    time += 1001;
    db = new Database(join(directory, 'jobs.pglite'));
    jobs = await new DurableJobs(db, cipher, () => time).initialize();
    expect((await jobs.submit(submission)).id).toBe(job.id);
    const next = (await jobs.claim(['webhook.delivery']))!;
    expect(next.leaseToken).not.toBe(claim.leaseToken);
    expect(
      (await jobs.finish(job.id, next.leaseToken, { success: true }, ['webhook.delivery'])).state,
    ).toBe('succeeded');
    expect(await jobs.attempts(job.id)).toHaveLength(2);
  } finally {
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
