import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../apps/api/src/index';
import { createClient } from '@qb-flex/client';
export const ownership = {
  op: 'eq',
  left: { column: 'owner_id' },
  right: { claim: 'sub' },
} as const;
export async function fixture(override?: Parameters<typeof startService>[0]) {
  const directory = mkdtempSync(join(tmpdir(), 'qb-network-'));
  const service = await startService({
    dataDir: directory,
    port: 0,
    master: 'test-master-encryption-key-32-characters',
    publicURL: 'http://localhost:7612',
    ...override,
  });
  const url = `http://localhost:${service.server.port}`;
  async function response(
    path: string,
    method = 'GET',
    body?: unknown,
    token?: string,
    headers?: Record<string, string>,
  ) {
    return fetch(url + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function call(
    path: string,
    method = 'GET',
    body?: unknown,
    token?: string,
    headers?: Record<string, string>,
  ) {
    const r = await response(path, method, body, token, headers);
    const value = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(value));
    return value;
  }
  const bootstrap = (await Bun.file(join(directory, 'bootstrap.token')).text()).trim();
  await call('/setup', 'POST', {
    bootstrapToken: bootstrap,
    email: 'owner@example.com',
    password: 'owner-password-12345',
    name: 'Owner',
  });
  const session = await call('/platform/auth/sign-in/email', 'POST', {
    email: 'owner@example.com',
    password: 'owner-password-12345',
  });
  const token = session.token;
  const organizations = await call('/management/v1/organizations', 'GET', undefined, token);
  async function project(slug: string) {
    const p = await call(
      '/management/v1/projects',
      'POST',
      { organizationId: organizations.data[0].id, name: slug, slug },
      token,
    );
    await service.tick();
    const base = `/management/v1/projects/${p.data.id}/branches/${p.data.branchId}`;
    const sql =
      "CREATE TABLE tasks(id TEXT PRIMARY KEY NOT NULL DEFAULT(replace(gen_random_uuid()::text,'-','')),owner_id TEXT NOT NULL,title TEXT NOT NULL,completed BIGINT NOT NULL DEFAULT 0,revision BIGINT NOT NULL DEFAULT 1,internal_note TEXT);CREATE INDEX tasks_owner ON tasks(owner_id);";
    const review = await call(
      base + '/reviews',
      'POST',
      { migrationId: '001', sql },
      token,
    );
    await call(base + '/reviews/' + review.data.id + '/rehearse', 'POST', {}, token);
    await call(base + '/reviews/' + review.data.id + '/approve', 'POST', {}, token);
    await call(base + '/migrations', 'POST', { reviewId: review.data.id }, token);
    await call(
      base + '/exposure/tasks',
      'PUT',
      { enabled: true, columns: ['id', 'owner_id', 'title', 'completed', 'revision'] },
      token,
    );
    for (const operation of ['select', 'insert', 'update', 'delete'])
      await call(
        base + '/policies',
        'PUT',
        {
          resource: 'tasks',
          operation,
          roles: ['authenticated'],
          mode: 'permissive',
          using: ownership,
          check: ownership,
          enabled: true,
        },
        token,
      );
    const key = (await call(`/management/v1/projects/${p.data.id}/keys`, 'POST', {}, token)).data
      .key;
    const client = createClient({
      url,
      projectId: p.data.id,
      branch: p.data.branchId,
      publishableKey: key,
    });
    return {
      id: String(p.data.id),
      branchId: String(p.data.branchId),
      operationId: String(p.data.operationId),
      base,
      key,
      client,
    };
  }
  return {
    directory,
    service,
    url,
    token,
    organizations: organizations.data,
    response,
    call,
    project,
    async close() {
      await service.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
