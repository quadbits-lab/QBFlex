import { test, expect } from 'bun:test';
import { fixture } from '../helpers';
import { createClient } from '@qb-flex/client';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
async function until(predicate: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!predicate() && Date.now() < end) await Bun.sleep(20);
  expect(predicate()).toBe(true);
}
test('real network isolation across two users/projects/branches, hidden schema, CORS, scopes and session revocation', async () => {
  const f = await fixture();
  try {
    const a = await f.project('alpha'),
      b = await f.project('beta');
    const alice = await a.client.auth.signUp({
      email: 'alice@example.com',
      password: 'alice-password-12345',
      name: 'Alice',
    });
    await a.client.from('tasks').insert({ id: 'a', owner_id: alice!.user.id, title: 'Private' });
    const bob = createClient({
      url: f.url,
      projectId: a.id,
      branch: a.branchId,
      publishableKey: a.key,
    });
    await bob.auth.signUp({
      email: 'bob@example.com',
      password: 'bob-password-12345',
      name: 'Bob',
    });
    expect((await bob.from('tasks').count()).meta.count).toBe(0);
    expect(bob.from('tasks').update('a', { title: 'Stolen' })).rejects.toMatchObject({
      status: 404,
    });
    let r = await f.response(
      `/v1/projects/${b.id}/branches/${b.branchId}/data/tasks`,
      'GET',
      undefined,
      a.client.getToken()!,
      { 'x-qb-key': b.key },
    );
    expect(r.status).toBe(401);
    r = await f.response(
      `/management/v1/projects/${a.id}/branches/${a.branchId}/schema`,
      'GET',
      undefined,
      a.client.getToken()!,
    );
    expect(r.status).toBe(401);
    const schema: any = await a.client.request('/schema');
    expect(schema.data.tables[0].columns.some((c: any) => c.name === 'internal_note')).toBe(false);
    expect(
      a.client.from('tasks').filter('internal_note', 'eq', 'secret').execute(),
    ).rejects.toMatchObject({ status: 400 });
    r = await f.response(
      `/v1/projects/${a.id}/branches/${a.branchId}/data/tasks`,
      'GET',
      undefined,
      undefined,
      { 'x-qb-key': a.key, origin: 'https://evil.example' },
    );
    expect(r.status).toBe(403);
    const c = (await f.call(`/management/v1/projects/${a.id}/config`, 'GET', undefined, f.token))
      .data;
    r = await f.response(
      `/management/v1/projects/${a.id}/config`,
      'PUT',
      { origins: ['http://localhost:9999'] },
      f.token,
    );
    expect(r.status).toBe(409);
    await f.call(
      `/management/v1/projects/${a.id}/config`,
      'PUT',
      { origins: ['http://localhost:9999'] },
      f.token,
      { 'if-match': String(c.version) },
    );
    r = await f.response(
      `/v1/projects/${a.id}/branches/${a.branchId}/data/tasks`,
      'GET',
      undefined,
      undefined,
      { 'x-qb-key': a.key, origin: 'http://localhost:9999' },
    );
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:9999');
    r = await f.response(
      `/v1/projects/${a.id}/branches/${a.branchId}/data/tasks`,
      'OPTIONS',
      undefined,
      undefined,
      {
        'x-qb-key': a.key,
        origin: 'http://127.0.0.1:9999',
        'access-control-request-method': 'GET',
      },
    );
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:9999');
    r = await f.response('/setup', 'OPTIONS', undefined, undefined, {
      origin: 'http://127.0.0.1:7610',
      'access-control-request-method': 'GET',
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:7610');
    const secret = (
      await f.call(
        `/management/v1/projects/${a.id}/keys`,
        'POST',
        { scope: 'service', branch: a.branchId, tables: ['tasks'], methods: ['GET'], bypass: true },
        f.token,
      )
    ).data.key;
    r = await f.response(
      `/v1/projects/${a.id}/branches/${a.branchId}/data/tasks`,
      'GET',
      undefined,
      undefined,
      { 'x-qb-key': secret },
    );
    expect((await r.json()).data.length).toBe(1);
    r = await f.response(
      `/v1/projects/${a.id}/branches/${a.branchId}/data/tasks`,
      'POST',
      {},
      undefined,
      { 'x-qb-key': secret },
    );
    expect(r.status).toBe(403);
    const backup = (await f.call(a.base + '/backups', 'POST', {}, f.token)).data;
    const restored = (
      await f.call(
        `/management/v1/projects/${a.id}/backups/${backup.id}/restore`,
        'POST',
        {},
        f.token,
      )
    ).data;
    r = await f.response(
      `/v1/projects/${a.id}/branches/${restored.branchId}/data/tasks`,
      'GET',
      undefined,
      a.client.getToken()!,
      { 'x-qb-key': a.key },
    );
    expect(r.status).toBe(401);
    const restoredClient = createClient({
      url: f.url,
      projectId: a.id,
      branch: restored.branchId,
      publishableKey: a.key,
    });
    const again = await restoredClient.auth.signIn({
      email: 'alice@example.com',
      password: 'alice-password-12345',
    });
    expect(again.user.id).toBe(alice!.user.id);
    expect((await restoredClient.from('tasks')).data.length).toBe(1);
    await f.call(a.base + '/users/' + alice!.user.id + '/sessions', 'DELETE', undefined, f.token);
    expect(await a.client.auth.refreshSession()).toBeNull();
    expect((await a.client.from('tasks')).data).toEqual([]);
    a.client.dispose();
    b.client.dispose();
    bob.dispose();
    restoredClient.dispose();
  } finally {
    await f.close();
  }
}, 30000);
test('real realtime stream respects ownership, resumes after a disconnect and reauthorizes revoked sessions', async () => {
  const f = await fixture();
  try {
    const p = await f.project('events');
    const alice = await p.client.auth.signUp({
      email: 'alice@example.com',
      password: 'alice-password-12345',
      name: 'Alice',
    });
    const events: any[] = [];
    let connected = false;
    const channel = p.client
      .channel({
        table: 'tasks',
        onEvent: (e) => events.push(e),
        onStatus: (s) => (connected = s === 'connected'),
      })
      .subscribe();
    await until(() => connected);
    await p.client.from('tasks').insert({ id: 'one', owner_id: alice!.user.id, title: 'First' });
    await until(() => events.length === 1);
    expect(events[0].payload.title).toBe('First');
    const bob = createClient({
      url: f.url,
      projectId: p.id,
      branch: p.branchId,
      publishableKey: p.key,
    });
    const bobSession = await bob.auth.signUp({
      email: 'bob@example.com',
      password: 'bob-password-12345',
      name: 'Bob',
    });
    await bob
      .from('tasks')
      .insert({ id: 'hidden', owner_id: bobSession!.user.id, title: 'Secret' });
    await Bun.sleep(300);
    expect(events.length).toBe(1);
    (channel as any).socket.close(1012, 'test restart');
    connected = false;
    await p.client.from('tasks').update('one', { title: 'Offline change' });
    await until(() => events.length === 2, 5000);
    expect(events[1].payload.title).toBe('Offline change');
    await p.client.from('tasks').delete('one');
    await until(() => events.length === 3);
    expect(events[2].payload).toEqual({ id: 'one' });
    await f.call(p.base + '/users/' + alice!.user.id + '/sessions', 'DELETE', undefined, f.token);
    await until(() => !connected);
    channel.unsubscribe();
    p.client.dispose();
    bob.dispose();
  } finally {
    await f.close();
  }
}, 30000);
test.skipIf(process.env.QB_INTEGRATION_STORAGE !== '1')(
  'real S3 storage validates size, permissions, private bytes, finalization and deletion',
  async () => {
    const f = await fixture();
    try {
      const p = await f.project('storage');
      const alice = await p.client.auth.signUp({
        email: 'alice@example.com',
        password: 'alice-password-12345',
        name: 'Alice',
      });
      const bucket = (
        await f.call(
          p.base + '/buckets',
          'POST',
          { name: 'files', visibility: 'private', maxSize: 1024, mimeRules: ['text/plain'] },
          f.token,
        )
      ).data.id;
      const file = new Blob(['private file bytes'], { type: 'text/plain' });
      const uploadOptions = { idempotencyKey: crypto.randomUUID() };
      const uploaded = await p.client.storage.upload(bucket, 'notes.txt', file, uploadOptions);
      expect(uploaded.data.state).toBe('ready');
      expect(
        (await p.client.storage.upload(bucket, 'notes.txt', file, uploadOptions)).data.id,
      ).toBe(uploaded.data.id);
      expect(
        p.client.storage.upload(
          bucket,
          'notes.txt',
          new Blob(['different content'], { type: 'text/plain' }),
          uploadOptions,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(await (await p.client.storage.download(uploaded.data.id)).text()).toBe(
        'private file bytes',
      );
      expect((await p.client.storage.list(bucket)).data.length).toBe(1);
      const bob = createClient({
        url: f.url,
        projectId: p.id,
        branch: p.branchId,
        publishableKey: p.key,
      });
      await bob.auth.signUp({
        email: 'bob@example.com',
        password: 'bob-password-12345',
        name: 'Bob',
      });
      expect(bob.storage.download(uploaded.data.id)).rejects.toMatchObject({ status: 404 });
      expect((await bob.storage.list(bucket)).data).toEqual([]);
      expect(
        p.client.storage.upload(
          bucket,
          'bad.txt',
          new Blob(['x'.repeat(1025)], { type: 'text/plain' }),
        ),
      ).rejects.toMatchObject({ status: 413 });
      expect(
        p.client.storage.upload(bucket, 'bad.png', new Blob(['bad'], { type: 'image/png' })),
      ).rejects.toMatchObject({ code: 'MIME_DENIED' });
      const intent: any = await p.client.request(`/storage/buckets/${bucket}/objects`, 'POST', {
        key: 'mismatch.txt',
        size: 20,
        mime: 'text/plain',
      });
      expect(
        p.client.request(`/storage/objects/${intent.data.id}/content`, 'PUT', new Blob(['short'])),
      ).rejects.toMatchObject({ code: 'UPLOAD_MISMATCH' });
      expect(p.client.storage.download(intent.data.id)).rejects.toMatchObject({ status: 404 });
      await p.client.storage.remove(uploaded.data.id);
      expect(p.client.storage.download(uploaded.data.id)).rejects.toMatchObject({ status: 404 });
      p.client.dispose();
      bob.dispose();
    } finally {
      await f.close();
    }
  },
  30000,
);
