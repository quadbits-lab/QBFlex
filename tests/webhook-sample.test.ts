import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { createHmac } from 'node:crypto';
import { initializeBranch, expose } from '@qb-flex/schema';
import { encryption } from '@qb-flex/auth';
import { BranchEngine } from '../packages/database/src/engine';
import { DurableJobs } from '../packages/database/src/jobs';
import { Webhooks } from '../packages/database/src/webhooks';

const keyId = '11111111-1111-1111-1111-111111111111';

test('webhook sample signs timestamp.eventId.body and does not advance the checkpoint', async () => {
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
  await engine.refresh();
  let time = 1_000_000;
  const jobs = await new DurableJobs(db, cipher, () => time).initialize();
  const hooks = await new Webhooks(engine, jobs, cipher, 'branch-test', () => time).initialize();
  try {
    const subscription = await hooks.create({
      name: 'Tasks hook',
      url: 'https://receiver.example/events',
      serviceKeyId: keyId,
      table: 'tasks',
      columns: ['id', 'title'],
      events: ['insert', 'update', 'delete'],
    });
    const before = (await hooks.list())[0]!.checkpoint;
    const sample = await hooks.sample(subscription.id);
    const timestamp = sample.headers['x-qb-timestamp']!;
    const signature = createHmac('sha256', subscription.signingSecret)
      .update(`${timestamp}.${sample.eventId}.`)
      .update(sample.body)
      .digest('hex');
    expect(sample.headers['x-qb-signature']).toBe('v1=' + signature);
    expect(sample.headers['x-qb-event-id']).toBe(sample.eventId);
    expect((await hooks.list())[0]!.checkpoint).toBe(before);
    expect((await hooks.list())[0]!.checkpoint).toBe(subscription.checkpoint);
  } finally {
    await db.close();
  }
});
