import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../helpers';
import { ManagementClient } from '@qb-flex/management-client';
test('policy fixture endpoint is isolated, legacy test cannot bypass policies, DELETE honors revisions, job routes are private', async () => {
  const f = await fixture();
  try {
    const p = await f.project('expanded');
    const alice = await p.client.auth.signUp({
      email: 'alice@example.com',
      password: 'alice-password-12345',
      name: 'Alice',
    });
    await p.client
      .from('tasks')
      .insert({ id: 'live', owner_id: alice!.user.id, title: 'live private value' });
    const read = await f.call(
      p.base + '/policies/test',
      'POST',
      {
        table: 'tasks',
        privileged: true,
        identity: { role: 'anonymous', sub: null },
        query: { limit: 10 },
      },
      f.token,
    );
    expect(read.data).toEqual([]);
    const simulation = await f.call(
      p.base + '/policies/test',
      'POST',
      {
        table: 'tasks',
        operation: 'update',
        identity: { role: 'authenticated', sub: 'synthetic' },
        fixtures: { tasks: [{ id: 'scratch', owner_id: 'synthetic', title: 'fixture' }] },
        key: 'scratch',
        input: { owner_id: 'other-user' },
        privileged: true,
      },
      f.token,
    );
    expect(simulation.data.allowed).toBe(false);
    expect(simulation.data.oldRowAccess).toBe(true);
    expect(simulation.data.prospectiveRowCheck).toBe(false);
    expect((await p.client.from('tasks').select()).data).toHaveLength(1);
    await p.client.from('tasks').update('live', { title: 'revision two' }, { revision: 1 });
    await expect(p.client.from('tasks').delete('live', { revision: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect((await p.client.from('tasks').select()).data).toHaveLength(1);
    await p.client.from('tasks').delete('live', { revision: 2 });
    expect((await p.client.from('tasks').select()).data).toHaveLength(0);
    const management = new ManagementClient(f.url, f.token);
    expect((await management.jobs(p.id, p.branchId).list()).data).toEqual([]);
    expect((await f.response(p.base + '/jobs')).status).toBe(401);
    expect(
      (await f.response(p.base + '/jobs', 'GET', undefined, p.client.getToken()!)).status,
    ).toBe(401);
    expect(
      (await f.response('/internal/jobs/claim', 'POST', { projectId: p.id, branchId: p.branchId }))
        .status,
    ).toBe(401);
    const worker = readFileSync(join(f.directory, 'worker.token'), 'utf8').trim();
    const owner = f.service.owners.get(p.branchId)!;
    const push = await owner.call('jobs-submit', {
      kind: 'push.dispatch',
      eventId: 'push-test',
      deduplicationKey: 'push-test',
      payload: { token: 'private-token-canary' },
    });
    const email = await owner.call('jobs-submit', {
      kind: 'alert.email',
      eventId: 'email-test',
      deduplicationKey: 'email-test',
      payload: { recipient: 'private-recipient-canary' },
    });
    const jobs = await management.jobs(p.id, p.branchId).list({ limit: 1 });
    expect(jobs.data).toHaveLength(1);
    expect(jobs.meta.cursor).toBeDefined();
    const next = await management
      .jobs(p.id, p.branchId)
      .list({ limit: 1, cursor: jobs.meta.cursor });
    expect(next.data[0]!.id).not.toBe(jobs.data[0]!.id);
    expect(JSON.stringify(jobs)).not.toMatch(/private-token|private-recipient|leaseToken|payload/);
    const claim = await f.call(
      '/internal/jobs/claim',
      'POST',
      { projectId: p.id, branchId: p.branchId, kinds: ['push.dispatch'] },
      worker,
    );
    expect(claim.data.id).toBe(email.id);
    expect(claim.data.kind).toBe('alert.email');
    await f.call(
      '/internal/jobs/finish',
      'POST',
      {
        projectId: p.id,
        branchId: p.branchId,
        id: email.id,
        leaseToken: claim.data.leaseToken,
        result: { success: false, code: 'TEST_FAILURE' },
        kinds: ['push.dispatch'],
      },
      worker,
    );
    const retry = await management.jobs(p.id, p.branchId).replay(email.id, 'explicit-replay');
    expect(retry.data.parentId).toBe(email.id);
    expect((await management.jobs(p.id, p.branchId).get(email.id)).data.history).toHaveLength(1);
    expect(
      (
        await f.response(p.base + '/jobs/' + push.id + '/replay', 'POST', undefined, f.token, {
          'idempotency-key': 'no-bypass',
        })
      ).status,
    ).toBe(409);
    const backup = await f.call(p.base + '/backups', 'POST', {}, f.token);
    expect(backup.data.format).toBe(2);
    const restored = await f.call(
      `/management/v1/projects/${p.id}/backups/${backup.data.id}/restore`,
      'POST',
      {},
      f.token,
    );
    expect((await management.jobs(p.id, restored.data.branchId).list()).data).toEqual([]);
    expect((await management.jobs(p.id, p.branchId).list()).data).toHaveLength(3);
    const capabilities = await f.call('/management/v1/capabilities', 'GET', undefined, f.token);
    expect(capabilities.data.push).toBe('planned');
    expect(capabilities.data.nativeSDK).toBe('planned');
  } finally {
    await f.close();
  }
}, 30000);
test.skipIf(process.env.QB_INTEGRATION_STORAGE !== '1')(
  'streamed S3 uploads verify optional checksums before finalization and preserve legacy clients',
  async () => {
    const f = await fixture();
    try {
      const p = await f.project('stream-checksum');
      await p.client.auth.signUp({
        email: 'uploads@example.com',
        password: 'upload-password-12345',
        name: 'Uploads',
      });
      const bucket = (
        await f.call(
          p.base + '/buckets',
          'POST',
          { name: 'files', visibility: 'private', maxSize: 10485760, mimeRules: [] },
          f.token,
        )
      ).data.id;
      const file = new Blob([new Uint8Array(2 * 1048576).fill(12)], {
        type: 'application/octet-stream',
      });
      const checksum = new Bun.CryptoHasher('sha256')
        .update(await file.arrayBuffer())
        .digest('hex');
      const upload = await p.client.storage.upload(bucket, 'correct.bin', file, { checksum });
      expect(upload.data.state).toBe('ready');
      expect((await p.client.storage.download(upload.data.id)).size).toBe(file.size);
      await p.client.storage.remove(upload.data.id);
      await expect(
        p.client.storage.upload(bucket, 'wrong.bin', file, { checksum: '0'.repeat(64) }),
      ).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
      expect(readdirSync(join(f.directory, 'transfers'))).toHaveLength(0);
      const legacy = await p.client.storage.upload(
        bucket,
        'legacy.bin',
        new Blob(['legacy'], { type: 'text/plain' }),
      );
      expect(legacy.data.state).toBe('ready');
      await p.client.storage.remove(legacy.data.id);
    } finally {
      await f.close();
    }
  },
  30000,
);
test('restricted push principal cannot claim maintenance jobs or access metrics/maintenance APIs', async () => {
  const savedEnabled = process.env.QB_PUSH_ENABLED;
  const savedToken = process.env.QB_PUSH_WORKER_TOKEN;
  const pushToken = 'isolated-push-worker-test-token-32-characters';
  let f: Awaited<ReturnType<typeof fixture>>;
  try {
    process.env.QB_PUSH_ENABLED = 'true';
    process.env.QB_PUSH_WORKER_TOKEN = pushToken;
    f = await fixture();
  } finally {
    if (savedEnabled === undefined) delete process.env.QB_PUSH_ENABLED;
    else process.env.QB_PUSH_ENABLED = savedEnabled;
    if (savedToken === undefined) delete process.env.QB_PUSH_WORKER_TOKEN;
    else process.env.QB_PUSH_WORKER_TOKEN = savedToken;
  }
  try {
    const p = await f!.project('executor-scope');
    const owner = f!.service.owners.get(p.branchId)!;
    const maintenance = await owner.call('jobs-submit', {
      kind: 'maintenance',
      eventId: 'maintenance-test',
      deduplicationKey: 'maintenance-test',
      payload: {},
    });
    const push = await owner.call('jobs-submit', {
      kind: 'push.receipts',
      eventId: 'push-test',
      deduplicationKey: 'push-test',
      payload: {},
    });
    const claim = await f!.call(
      '/internal/jobs/claim',
      'POST',
      { projectId: p.id, branchId: p.branchId, kinds: ['maintenance'] },
      pushToken,
    );
    expect(claim.data.id).toBe(push.id);
    expect((await f!.response('/internal/maintenance', 'POST', {}, pushToken)).status).toBe(401);
    expect((await f!.response('/internal/metrics', 'GET', undefined, pushToken)).status).toBe(401);
    const worker = readFileSync(join(f!.directory, 'worker.token'), 'utf8').trim();
    expect(
      (
        await f!.response(
          '/internal/jobs/finish',
          'POST',
          {
            projectId: p.id,
            branchId: p.branchId,
            id: push.id,
            leaseToken: claim.data.leaseToken,
            result: { success: true },
          },
          worker,
        )
      ).status,
    ).toBe(403);
    expect((await owner.call('jobs-get', { id: maintenance.id })).state).toBe('queued');
    expect(
      (
        await f!.response(
          '/internal/jobs/claim',
          'POST',
          { projectId: p.id, branchId: 'primary' },
          pushToken,
        )
      ).status,
    ).toBe(400);
  } finally {
    await f!.close();
  }
}, 30000);
