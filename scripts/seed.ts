import { existsSync, writeFileSync } from 'node:fs';
import { createService } from '../apps/api/src/service';
import { ownership } from '../tests/helpers';
// Explicit opt-in local tutorial provisioning; never makes a hidden administrator.
if (process.env.NODE_ENV === 'production') throw new Error('Tutorial setup is local-only');
if (!process.env.QB_SEED_OWNER_EMAIL || !process.env.QB_SEED_OWNER_PASSWORD)
  throw new Error(
    'Set QB_SEED_OWNER_EMAIL and QB_SEED_OWNER_PASSWORD for the existing platform owner',
  );
const service = await createService();
try {
  const session = await service.platform.api.signInEmail({
    body: { email: process.env.QB_SEED_OWNER_EMAIL, password: process.env.QB_SEED_OWNER_PASSWORD },
  });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${session.token}` };
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await service.app.handle(
      new Request('http://localhost:7612' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? 'Tutorial setup failed');
    return result.data;
  }
  const org = (await call('/management/v1/organizations'))[0];
  const p = await call('/management/v1/projects', 'POST', {
    organizationId: org.id,
    name: 'Task tutorial',
    slug: 'task-tutorial',
  });
  await service.tick();
  const base = `/management/v1/projects/${p.id}/branches/${p.branchId}`;
  await call(base + '/migrations', 'POST', {
    id: '001',
    sql: `CREATE TABLE tasks(id TEXT PRIMARY KEY NOT NULL DEFAULT(lower(hex(randomblob(16)))),owner_id TEXT NOT NULL,title TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),revision INTEGER NOT NULL DEFAULT 1);CREATE INDEX tasks_owner ON tasks(owner_id);`,
  });
  await call(base + '/exposure/tasks', 'PUT', {
    enabled: true,
    columns: ['id', 'owner_id', 'title', 'completed', 'revision'],
  });
  for (const operation of ['select', 'insert', 'update', 'delete'])
    await call(base + '/policies', 'PUT', {
      resource: 'tasks',
      operation,
      roles: ['authenticated'],
      mode: 'permissive',
      enabled: true,
      using: ownership,
      check: ownership,
    });
  const key = await call(`/management/v1/projects/${p.id}/keys`, 'POST', {});
  const bucket = await call(base + '/buckets', 'POST', {
    name: 'attachments',
    visibility: 'private',
    maxSize: 10485760,
    mimeRules: [],
  });
  writeFileSync(
    '.data/tutorial.json',
    JSON.stringify(
      { projectId: p.id, branch: p.branchId, publishableKey: key.key, bucketId: bucket.id },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log('Tutorial configuration saved to .data/tutorial.json');
} finally {
  await service.close();
}
