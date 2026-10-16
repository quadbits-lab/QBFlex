import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { createHmac } from 'node:crypto';
import { initializeBranch, expose } from '@qb-flex/schema';
import { encryption } from '@qb-flex/auth';
import { BranchEngine } from '../packages/database/src/engine';
import { DurableJobs } from '../packages/database/src/jobs';
import { Webhooks } from '../packages/database/src/webhooks';
const keyId = '11111111-1111-1111-1111-111111111111';
async function harness() {
  const db = new Database(':memory:', { safeIntegers: true });
  await db.exec('');
  await initializeBranch(db);
  const cipher = encryption('isolated-webhook-master-key-32-characters');
  const engine = await new BranchEngine(db, 'isolated-webhook-engine-secret').initialize();
  await engine.migration(
    '001',
    'CREATE TABLE tasks(id TEXT PRIMARY KEY,owner_id TEXT,title TEXT,internal_note TEXT,revision BIGINT DEFAULT 1);',
    'test',
  );
  await expose(db, 'tasks', true, ['id', 'owner_id', 'title', 'revision']);
  await engine.savePolicy({
    resource: 'tasks',
    operation: 'select',
    roles: ['service'],
    mode: 'permissive',
    using: { op: 'eq', left: { column: 'owner_id' }, right: { claim: 'sub' } },
    check: { op: 'true' },
    enabled: true,
  });
  let time = 1000000;
  const jobs = await new DurableJobs(db, cipher, () => time++).initialize(),
    hooks = await new Webhooks(engine, jobs, cipher, 'branch-test', () => time).initialize();
  const input = {
    name: 'Tasks hook',
    url: 'https://receiver.example/events',
    serviceKeyId: keyId,
    table: 'tasks',
    columns: ['id', 'title'],
    events: ['insert', 'update', 'delete'] as ('insert' | 'update' | 'delete')[],
  };
  const insert = async (id: string, owner = keyId, title = 'Allowed') =>
    await engine.mutate(
      'tasks',
      'insert',
      { id, owner_id: owner, title, internal_note: 'hidden-canary' },
      { sub: null, role: 'anonymous' },
      undefined,
      undefined,
      true,
    );
  return { db, engine, jobs, hooks, input, insert, advance: (ms: number) => (time += ms) };
}
test('webhook fanout checkpoints and encrypted reference jobs commit atomically and deduplicate', async () => {
  const h = await harness();
  try {
    await h.insert('pre-subscription');
    const subscription = await h.hooks.create(h.input);
    expect(subscription.checkpoint).toBe(1);
    await h.insert('first');
    await h.insert('other', 'another-user');
    await expect(
      (async () =>
        await h.db
          .transaction(async () => {
            await h.hooks.produce();
            throw new Error('crash');
          })
          .immediate())(),
    ).rejects.toThrow('crash');
    expect(await h.jobs.list()).toHaveLength(0);
    expect((await h.hooks.list())[0]!.checkpoint).toBe(1);
    expect(await h.hooks.produce()).toEqual({ submitted: 2, gaps: 0 });
    expect((await h.hooks.produce()).submitted).toBe(0);
    expect(await h.jobs.list()).toHaveLength(2);
    const stored = JSON.stringify(
      await h.db.query('SELECT * FROM _qb_webhooks').all(),
      (_key, value) => (typeof value === 'bigint' ? String(value) : value),
    );
    expect(stored).not.toContain(subscription.signingSecret);
    expect(stored).not.toContain('receiver.example');
    expect(JSON.stringify(await h.hooks.list())).not.toMatch(/signingSecret|secret|\/events/);
    const claim = (await h.jobs.claim(['webhook.delivery']))!;
    expect(claim.payload).toEqual({ subscriptionId: subscription.id, sequence: 2 });
    expect(JSON.stringify(claim.payload)).not.toContain('hidden-canary');
    h.advance(30000);
    await expect(
      (async () => await h.hooks.prepare(claim.id, claim.leaseToken, keyId))(),
    ).rejects.toThrow('lease no longer valid');
    const other = (await h.jobs.claim(['webhook.delivery']))!;
    await h.jobs.finish(other.id, other.leaseToken, { success: true }, ['webhook.delivery']);
    const reclaim = (await h.jobs.claim(['webhook.delivery']))!;
    expect(reclaim.eventId).toBe(claim.eventId);
    expect((await h.hooks.prepare(reclaim.id, reclaim.leaseToken, keyId)).skipped).toBe(false);
  } finally {
    await h.db.close();
  }
});
test('dispatch rechecks real SELECT policies and projection, signs exact bytes, rotates with bounded overlap', async () => {
  const h = await harness();
  try {
    const subscription = await h.hooks.create(h.input);
    await h.insert('allowed');
    await h.insert('denied', 'other');
    await h.hooks.produce();
    const claim = (await h.jobs.claim(['webhook.delivery']))!;
    const first = await h.hooks.prepare(claim.id, claim.leaseToken, keyId);
    expect(first.skipped).toBe(false);
    if (first.skipped) throw new Error();
    expect(JSON.parse(first.body).payload).toEqual({ id: 'allowed', title: 'Allowed' });
    expect(first.body).not.toMatch(/hidden-canary|owner_id|internal_note/);
    const signature = (secret: string, body = first.body) =>
      createHmac('sha256', secret)
        .update(`${first.headers['x-qb-timestamp']}.${claim.eventId}.`)
        .update(body)
        .digest('hex');
    expect(first.headers['x-qb-signature']).toBe('v1=' + signature(subscription.signingSecret));
    expect(signature(subscription.signingSecret, first.body + ' ')).not.toBe(
      signature(subscription.signingSecret),
    );
    const rotated = await h.hooks.rotate(subscription.id);
    const overlap = await h.hooks.prepare(claim.id, claim.leaseToken, keyId);
    if (overlap.skipped) throw new Error();
    expect(overlap.headers['x-qb-signature']).toBe(
      `v1=${signature(rotated.signingSecret)},v1=${signature(subscription.signingSecret)}`,
    );
    await expect((async () => await h.hooks.rotate(subscription.id))()).rejects.toThrow('overlap');
    await h.jobs.finish(claim.id, claim.leaseToken, { success: true }, ['webhook.delivery']);
    const denied = (await h.jobs.claim(['webhook.delivery']))!;
    expect(await h.hooks.prepare(denied.id, denied.leaseToken, keyId)).toEqual({
      skipped: true,
      code: 'NOT_AUTHORIZED',
    });
    await h.jobs.finish(denied.id, denied.leaseToken, { success: true }, ['webhook.delivery']);
    h.advance(86400000);
    await h.insert('after-rotation');
    await h.hooks.produce();
    const next = (await h.jobs.claim(['webhook.delivery']))!;
    const body = await h.hooks.prepare(next.id, next.leaseToken, keyId);
    if (body.skipped) throw new Error();
    expect(body.headers['x-qb-signature']!.split(',')).toHaveLength(1);
    await expose(h.db, 'tasks', true, ['id', 'owner_id', 'revision']);
    expect(await h.hooks.prepare(next.id, next.leaseToken, keyId)).toEqual({
      skipped: true,
      code: 'NOT_AUTHORIZED',
    });
  } finally {
    await h.db.close();
  }
});
test('subscription state, policy revocation and replay gaps prevent unsafe dispatch; bounded fanout drains', async () => {
  const h = await harness();
  try {
    const subscription = await h.hooks.create(h.input);
    for (let i = 0; i < 205; i++) await h.insert('row-' + i);
    expect((await h.hooks.produce()).submitted).toBe(200);
    expect((await h.hooks.list())[0]!.checkpoint).toBe(200);
    expect((await h.hooks.produce()).submitted).toBe(5);
    const claim = (await h.jobs.claim(['webhook.delivery']))!;
    await h.hooks.state(subscription.id, 'paused');
    expect(await h.hooks.prepare(claim.id, claim.leaseToken, keyId)).toEqual({
      skipped: true,
      code: 'SUBSCRIPTION_INACTIVE',
    });
    await h.hooks.state(subscription.id, 'active');
    await h.db.exec('DELETE FROM _qb_policies');
    expect(await h.hooks.prepare(claim.id, claim.leaseToken, keyId)).toEqual({
      skipped: true,
      code: 'NOT_AUTHORIZED',
    });
    await h.db.exec(
      "UPDATE _qb_webhooks SET checkpoint=0;INSERT INTO _qb_meta VALUES('outbox_floor','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value;",
    );
    expect((await h.hooks.produce()).gaps).toBe(1);
    expect((await h.hooks.list())[0]!.state).toBe('resync_required');
    await expect((async () => await h.hooks.state(subscription.id, 'active'))()).rejects.toThrow(
      'replay gap',
    );
    await h.hooks.state(subscription.id, 'revoked');
    await expect((async () => await h.hooks.state(subscription.id, 'active'))()).rejects.toThrow(
      'cannot resume',
    );
    h.advance(30 * 86400000);
    await h.hooks.produce();
    expect(await h.hooks.list()).toHaveLength(0);
  } finally {
    await h.db.close();
  }
});
test('hidden/composite deletion keys, unexposed tables, malformed configurations and quotas fail closed', async () => {
  const h = await harness();
  try {
    await expect(
      (async () => await h.hooks.create({ ...h.input, columns: ['id', 'internal_note'] }))(),
    ).rejects.toThrow('exposed');
    await expect(
      (async () => await h.hooks.create({ ...h.input, columns: ['title'] }))(),
    ).rejects.toThrow('primary key');
    for (const url of [
      'http://example.org',
      'file:///tmp/file',
      'https://user:password@example.org',
      'https://example.org?token=x',
    ])
      await expect((async () => await h.hooks.create({ ...h.input, url }))()).rejects.toThrow(
        'HTTPS',
      );
    await expect(
      (async () => await h.hooks.create({ ...h.input, events: ['invalid'] as any }))(),
    ).rejects.toThrow('configuration');
    await h.hooks.create(h.input);
    await h.insert('delete-row');
    await h.hooks.produce();
    const insert = (await h.jobs.claim(['webhook.delivery']))!;
    await h.jobs.finish(insert.id, insert.leaseToken, { success: true }, ['webhook.delivery']);
    await h.engine.mutate(
      'tasks',
      'delete',
      undefined,
      { sub: null, role: 'anonymous' },
      'delete-row',
      undefined,
      true,
    );
    await h.hooks.produce();
    const deletion = (await h.jobs.claim(['webhook.delivery']))!,
      body = await h.hooks.prepare(deletion.id, deletion.leaseToken, keyId);
    if (body.skipped) throw new Error();
    expect(JSON.parse(body.body).payload).toEqual({ id: 'delete-row' });
    for (let i = 1; i < 20; i++) await h.hooks.create({ ...h.input, name: String(i) });
    await expect((async () => await h.hooks.create(h.input))()).rejects.toThrow('20 subscriptions');
  } finally {
    await h.db.close();
  }
});
test('queue backpressure rolls back every producer checkpoint rather than losing committed source events', async () => {
  const h = await harness();
  try {
    await h.hooks.create(h.input);
    await h.insert('wait-for-capacity');
    const seed = await h.jobs.submit({
      kind: 'maintenance',
      eventId: 'seed',
      deduplicationKey: 'seed',
      payload: {},
    });
    await h.db
      .query(
        `WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c WHERE n<9999)
      INSERT INTO _qb_jobs(id,event_id,kind,dedup_key,digest,payload,state,attempts,max_attempts,available_at,deadline_at,created_at,updated_at)
      SELECT 'fill-'||n,event_id,kind,'fill-'||n,digest,payload,state,attempts,max_attempts,available_at,deadline_at,created_at,updated_at
      FROM c CROSS JOIN _qb_jobs WHERE id=?`,
      )
      .run(seed.id);
    await expect((async () => await h.hooks.produce())()).rejects.toThrow('queue is full');
    expect((await h.hooks.list())[0]!.checkpoint).toBe(0);
    expect(await h.db.query('SELECT count(*) AS n FROM _qb_outbox').get()).toEqual({ n: 1 });
    await h.jobs.cancel(seed.id);
    expect((await h.hooks.produce()).submitted).toBe(1);
    expect((await h.hooks.list())[0]!.checkpoint).toBe(1);
  } finally {
    await h.db.close();
  }
});
