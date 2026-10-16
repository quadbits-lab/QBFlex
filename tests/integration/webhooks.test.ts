import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { ManagementClient } from '@qb-flex/management-client';
import { QBError } from '@qb-flex/contracts';
import { JobExecutor } from '../../apps/worker/src/job-executor';
import { fixture } from '../helpers';
test('webhook management scopes, dispatch-time authorization, signed delivery, replay dedup and restore exclusion', async () => {
  const f = await fixture();
  try {
    const p = await f.project('webhook-workflow'),
      owner = f.service.owners.get(p.branchId)!;
    const worker = readFileSync(join(f.directory, 'worker.token'), 'utf8').trim();
    const management = new ManagementClient(f.url, f.token),
      hooks = management.webhooks(p.id, p.branchId);
    const key = (
      await f.call(
        `/management/v1/projects/${p.id}/keys`,
        'POST',
        { scope: 'service', branch: p.branchId, tables: ['tasks'], methods: ['GET'] },
        f.token,
      )
    ).data;
    const input = {
      name: 'Task integration',
      url: 'https://receiver.example/events',
      serviceKeyId: key.id,
      table: 'tasks',
      columns: ['id', 'title'],
      events: ['insert', 'update', 'delete'] as ('insert' | 'update' | 'delete')[],
    };
    expect((await f.response(p.base + '/webhooks', 'GET')).status).toBe(401);
    expect(
      (
        await f.response(
          p.base + '/webhooks',
          'POST',
          { ...input, serviceKeyId: 'missing' },
          f.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.response(
          p.base + '/webhooks',
          'POST',
          { ...input, columns: ['id', 'internal_note'] },
          f.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.response(
          p.base + '/webhooks',
          'POST',
          { ...input, url: 'https://127.0.0.1/events' },
          f.token,
        )
      ).status,
    ).toBe(400);
    const bypass = (
      await f.call(
        `/management/v1/projects/${p.id}/keys`,
        'POST',
        { scope: 'service', branch: p.branchId, tables: ['tasks'], methods: ['GET'], bypass: true },
        f.token,
      )
    ).data;
    expect(
      (
        await f.response(
          p.base + '/webhooks',
          'POST',
          { ...input, serviceKeyId: bypass.id },
          f.token,
        )
      ).status,
    ).toBe(403);
    const sub = (await hooks.create(input)).data;
    expect(sub.signingSecret).toBeDefined();
    expect(JSON.stringify(await hooks.list())).not.toMatch(/signingSecret|\/events/);
    await f.call(
      p.base + '/data/tasks',
      'POST',
      { id: 'no-service-policy', owner_id: 'user', title: 'Not allowed' },
      f.token,
    );
    await f.call(
      '/internal/webhooks/produce',
      'POST',
      { projectId: p.id, branchId: p.branchId },
      worker,
    );
    const claimed = (
      await f.call(
        '/internal/jobs/claim',
        'POST',
        { projectId: p.id, branchId: p.branchId, executor: 'webhooks' },
        worker,
      )
    ).data;
    expect(
      (
        await f.call(
          '/internal/webhooks/prepare',
          'POST',
          { projectId: p.id, branchId: p.branchId, id: claimed.id, leaseToken: claimed.leaseToken },
          worker,
        )
      ).data,
    ).toEqual({ skipped: true, code: 'NOT_AUTHORIZED' });
    await f.call(
      '/internal/jobs/finish',
      'POST',
      {
        projectId: p.id,
        branchId: p.branchId,
        id: claimed.id,
        leaseToken: claimed.leaseToken,
        result: { success: true, code: 'NOT_AUTHORIZED' },
      },
      worker,
    );
    await f.call(
      p.base + '/policies',
      'PUT',
      {
        resource: 'tasks',
        operation: 'select',
        roles: ['service'],
        mode: 'permissive',
        using: { op: 'true' },
        check: { op: 'true' },
        enabled: true,
      },
      f.token,
    );
    await f.call(
      p.base + '/data/tasks',
      'POST',
      {
        id: 'delivered',
        owner_id: 'user',
        title: 'Delivered',
        internal_note: 'private-hidden-canary',
      },
      f.token,
    );
    const received = new Set<string>(),
      bodies: string[] = [];
    let fail = true;
    const executor = new JobExecutor(f.url, worker, {
      deliver: async (delivery) => {
        const id = delivery.headers['x-qb-event-id']!,
          timestamp = delivery.headers['x-qb-timestamp'];
        const signature = createHmac('sha256', sub.signingSecret)
          .update(`${timestamp}.${id}.`)
          .update(delivery.body)
          .digest('hex');
        expect(delivery.headers['x-qb-signature']).toBe('v1=' + signature);
        expect(JSON.parse(delivery.body).payload).toEqual({ id: 'delivered', title: 'Delivered' });
        expect(delivery.body).not.toMatch(/owner_id|private-hidden-canary|internal_note/);
        bodies.push(delivery.body);
        received.add(id);
        return fail
          ? { success: false, code: 'TEST_UNCERTAIN' }
          : { success: true, code: 'PROVIDER_ACCEPTED' };
      },
    });
    expect((await executor.tick()).finished).toBe(1);
    const dead = (await management.jobs(p.id, p.branchId).list()).data.find(
      (job) => job.state === 'dead',
    )!;
    expect(dead).toBeDefined();
    await management.jobs(p.id, p.branchId).replay(dead.id, 'explicit-receiver-dedup-test');
    fail = false;
    expect((await executor.tick()).finished).toBe(1);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(received.size).toBe(1);
    await f.call(
      p.base + '/data/tasks',
      'POST',
      { id: 'after-revoke', owner_id: 'user', title: 'Do not send' },
      f.token,
    );
    await f.call(`/management/v1/projects/${p.id}/keys/${key.id}`, 'DELETE', undefined, f.token);
    expect((await executor.tick()).finished).toBe(1);
    expect(bodies).toHaveLength(2);
    expect(
      (await management.jobs(p.id, p.branchId).list()).data.some(
        (job) => job.lastCode === 'KEY_REVOKED',
      ),
    ).toBe(true);
    const backup = (await f.call(p.base + '/backups', 'POST', {}, f.token)).data;
    const restored = (
      await f.call(
        `/management/v1/projects/${p.id}/backups/${backup.id}/restore`,
        'POST',
        {},
        f.token,
      )
    ).data;
    expect((await management.webhooks(p.id, restored.branchId).list()).data).toEqual([]);
    expect((await management.jobs(p.id, restored.branchId).list()).data).toEqual([]);
    expect((await owner.call('webhooks-list')).length).toBe(1);
  } finally {
    await f.close();
  }
}, 30000);
test('webhook queue backpressure does not suppress owner cleanup or scheduled maintenance', async () => {
  const f = await fixture();
  try {
    const p = await f.project('webhook-backpressure-maintenance');
    const owner = f.service.owners.get(p.branchId)!;
    const original = owner.call.bind(owner);
    let cleaned = false;
    owner.call = async (action, ...args) => {
      if (action === 'webhooks-produce')
        throw new QBError('QUEUE_FULL', 'Durable job queue is full', 503, true);
      if (action === 'cleanup') cleaned = true;
      return original(action, ...args);
    };
    try {
      await expect(f.service.maintain()).resolves.toBeDefined();
      expect(cleaned).toBe(true);
      // Other failures must stay observable rather than being treated as queue pressure.
      owner.call = async (action, ...args) => {
        if (action === 'webhooks-produce')
          throw new QBError('PAYLOAD_INTEGRITY', 'Corrupt configuration', 409);
        return original(action, ...args);
      };
      await expect(f.service.maintain()).rejects.toMatchObject({ code: 'PAYLOAD_INTEGRITY' });
    } finally {
      owner.call = original;
    }
  } finally {
    await f.close();
  }
}, 30000);
test('webhook executor cannot consume other kinds; push principal cannot prepare or produce webhooks', async () => {
  const saved = { enabled: process.env.QB_PUSH_ENABLED, token: process.env.QB_PUSH_WORKER_TOKEN };
  const push = 'isolated-push-principal-test-token-32-characters';
  let f: Awaited<ReturnType<typeof fixture>>;
  try {
    process.env.QB_PUSH_ENABLED = 'true';
    process.env.QB_PUSH_WORKER_TOKEN = push;
    f = await fixture();
  } finally {
    if (saved.enabled === undefined) delete process.env.QB_PUSH_ENABLED;
    else process.env.QB_PUSH_ENABLED = saved.enabled;
    if (saved.token === undefined) delete process.env.QB_PUSH_WORKER_TOKEN;
    else process.env.QB_PUSH_WORKER_TOKEN = saved.token;
  }
  try {
    const p = await f!.project('webhook-kinds'),
      worker = readFileSync(join(f!.directory, 'worker.token'), 'utf8').trim();
    const owner = f!.service.owners.get(p.branchId)!;
    const email = await owner.call('jobs-submit', {
      kind: 'alert.email',
      eventId: 'email',
      deduplicationKey: 'email',
      payload: {},
    });
    const executor = new JobExecutor(f!.url, worker);
    await f!.service.db.query('INSERT INTO branch_job_targets VALUES(?)').run(p.branchId);
    // Simulate an idle owner: delivery must not pin every branch open forever.
    await owner.close();
    expect((await executor.tick()).finished).toBe(0);
    expect(f!.service.owners.has(p.branchId)).toBe(false);
    await f!.call(p.base + '/schema', 'GET', undefined, f!.token);
    expect(
      (await f!.service.owners.get(p.branchId)!.call('jobs-get', { id: email.id })).state,
    ).toBe('queued');
    for (const route of ['/internal/webhooks/prepare', '/internal/webhooks/produce'])
      expect(
        (await f!.response(route, 'POST', { projectId: p.id, branchId: p.branchId }, push)).status,
      ).toBe(401);
    expect(
      (
        await f!.response(
          '/internal/jobs/claim',
          'POST',
          { projectId: p.id, branchId: p.branchId, executor: 'webhooks' },
          push,
        )
      ).status,
    ).toBe(403);
    expect((await f!.response('/internal/jobs/targets')).status).toBe(401);
  } finally {
    await f!.close();
  }
}, 30000);
