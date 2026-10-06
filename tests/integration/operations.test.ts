import { test, expect } from 'bun:test';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../helpers';
test('management scopes, signed pagination, quotas, corrupt backup denial and cancellation', async () => {
  const f = await fixture();
  try {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ data: 'x'.repeat(70000) })));
        controller.close();
      },
    });
    const tooLarge = await fetch(f.url + '/management/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:7610' },
      body,
    });
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).error.code).toBe('SIZE_LIMIT');
    expect(tooLarge.headers.get('access-control-allow-origin')).toBe('http://localhost:7610');
    const a = await f.project('operations-a'),
      b = await f.project('operations-b');
    const token = (
      await f.call('/management/v1/tokens', 'POST', { projects: [a.id], readOnly: true }, f.token)
    ).data.token;
    expect(
      (await f.call('/management/v1/projects', 'GET', undefined, token)).data.map((p: any) => p.id),
    ).toEqual([a.id]);
    expect((await f.response(b.base + '/schema', 'GET', undefined, token)).status).toBe(403);
    expect(
      (
        await f.response(
          a.base + '/migrations',
          'POST',
          { id: 'forbidden', sql: 'SELECT 1' },
          token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.response(
          '/management/v1/organizations/' + f.organizations[0].id + '/members',
          'GET',
          undefined,
          token,
        )
      ).status,
    ).toBe(403);
    const first = await f.call('/management/v1/projects?limit=1', 'GET', undefined, f.token);
    const second = await f.call(
      '/management/v1/projects?limit=1&cursor=' + encodeURIComponent(first.meta.cursor),
      'GET',
      undefined,
      f.token,
    );
    expect(first.data[0].id).not.toBe(second.data[0].id);
    expect(
      (
        await f.response(
          '/management/v1/audit?cursor=' + encodeURIComponent(first.meta.cursor),
          'GET',
          undefined,
          f.token,
        )
      ).status,
    ).toBe(400);
    expect((await f.response('/management/v1/tokens', 'GET', undefined, token)).status).toBe(403);
    const organizationToken = (
      await f.call(
        '/management/v1/tokens',
        'POST',
        { projects: [], organizations: [f.organizations[0].id] },
        f.token,
      )
    ).data.token;
    const provision = (
      await f.call(
        '/management/v1/projects',
        'POST',
        { organizationId: f.organizations[0].id, name: 'Cancel test', slug: 'cancel-test' },
        organizationToken,
      )
    ).data;
    // Stop automatic admissions to test the supported cancellation boundary deterministically.
    f.service.db
      .query("UPDATE operations SET status='requested' WHERE id=?")
      .run(provision.operationId);
    const cancellation = await f.call(
      '/management/v1/operations/' + provision.operationId + '/cancel',
      'POST',
      {},
      organizationToken,
    );
    expect(cancellation.data.status).toBe('cancelled');
    expect(
      (
        await f.call(
          '/management/v1/operations/' + provision.operationId + '/cancel',
          'POST',
          {},
          organizationToken,
        )
      ).data.status,
    ).toBe('cancelled');
    expect(
      (
        await f.response(
          '/management/v1/operations/' + a.operationId + '/cancel',
          'POST',
          {},
          f.token,
        )
      ).status,
    ).toBe(409);
    const checkpoint = (await f.call(b.base + '/backups', 'POST', {}, f.token)).data;
    const restore = (
      await f.call(
        '/management/v1/projects/' + b.id + '/backups/' + checkpoint.id + '/restore',
        'POST',
        {},
        f.token,
      )
    ).data;
    await f.call(
      '/management/v1/projects/' + b.id + '/branches/' + restore.branchId + '/cutover',
      'POST',
      { confirm: 'operations-b' },
      f.token,
    );
    expect(
      (
        await f.response(
          '/v1/projects/' + b.id + '/branches/' + b.branchId + '/schema',
          'GET',
          undefined,
          undefined,
          { 'x-qb-key': b.key },
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await f.response(
          '/v1/projects/' + b.id + '/branches/primary/schema',
          'GET',
          undefined,
          undefined,
          { 'x-qb-key': b.key },
        )
      ).status,
    ).toBe(200);
    await a.client.auth.signUp({
      name: 'Quota user',
      email: 'quota@example.com',
      password: 'application-password-12345',
    });
    const configuration = await f.call(
      '/management/v1/projects/' + a.id + '/config',
      'GET',
      undefined,
      f.token,
    );
    await f.call(
      '/management/v1/projects/' + a.id + '/config',
      'PUT',
      { quotas: { databaseBytes: 1, storageBytes: 2 } },
      f.token,
      { 'if-match': String(configuration.data.version) },
    );
    await expect(
      a.client.from('tasks').insert({ title: 'Quota', owner_id: a.client.getSession()!.user.id }),
    ).rejects.toMatchObject({ code: 'QUOTA', status: 429 });
    const bucket = (
      await f.call(
        a.base + '/buckets',
        'POST',
        { name: 'quota-files', visibility: 'private', maxSize: 100, mimeRules: [] },
        f.token,
      )
    ).data.id;
    const intent = await f.response(
      `/v1/projects/${a.id}/branches/primary/storage/buckets/${bucket}/objects`,
      'POST',
      { key: 'large.txt', size: 3, mime: 'text/plain' },
      a.client.getToken()!,
      { 'x-qb-key': a.key },
    );
    // With no S3 configuration the dependency error precedes reservation validation.
    if (process.env.QB_S3_ENDPOINT) expect(intent.status).toBe(429);
    else expect(intent.status).toBe(503);
    const current = await f.call(
      '/management/v1/projects/' + a.id + '/config',
      'GET',
      undefined,
      f.token,
    );
    await f.call(
      '/management/v1/projects/' + a.id + '/config',
      'PUT',
      { quotas: { requestsPerMinute: 1 } },
      f.token,
      { 'if-match': String(current.data.version) },
    );
    const key = (await f.call('/management/v1/projects/' + a.id + '/keys', 'POST', {}, f.token))
      .data.key;
    const path = `/v1/projects/${a.id}/branches/primary/schema`;
    expect((await f.response(path, 'GET', undefined, undefined, { 'x-qb-key': key })).status).toBe(
      200,
    );
    expect((await f.response(path, 'GET', undefined, undefined, { 'x-qb-key': key })).status).toBe(
      429,
    );
    const backup = (await f.call(a.base + '/backups', 'POST', {}, f.token)).data;
    const record = f.service.db.query('SELECT path FROM backups WHERE id=?').get(backup.id) as any;
    const bytes = readFileSync(record.path);
    bytes[20] ^= 0xff;
    writeFileSync(record.path, bytes);
    const failed = await f.response(
      '/management/v1/projects/' + a.id + '/backups/' + backup.id + '/restore',
      'POST',
      {},
      f.token,
    );
    expect(failed.status).toBe(409);
    expect((await failed.json()).error.code).toBe('BACKUP_CORRUPT');
    a.client.dispose();
    b.client.dispose();
  } finally {
    await f.close();
  }
}, 20000);
