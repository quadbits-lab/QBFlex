import { expect, test } from 'bun:test';
import { fixture } from '../helpers';
import { ManagementClient } from '@qb-flex/management-client';
test('Security Advisor is management-only, derives control evidence, binds acknowledgments and excludes them from restore', async () => {
  const f = await fixture();
  try {
    const p = await f.project('advisor'),
      client = new ManagementClient(f.url, f.token).security(p.id, p.branchId);
    const first = (await client.scan()).data;
    expect(first.findings.some((f) => f.code === 'ADMIN_MFA_GAP')).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(
      /owner@example.com|owner-password|qb_pk_|hash|ciphertext/,
    );
    expect(first.truncated).toBe(false);
    const readOnly = (
      await f.call('/management/v1/tokens', 'POST', { projects: [p.id], readOnly: true }, f.token)
    ).data.token;
    expect((await f.response(p.base + '/security', 'GET', undefined, readOnly)).status).toBe(200);
    expect((await f.response(p.base + '/security')).status).toBe(401);
    const app = await p.client.auth.signUp({
      email: 'application@example.com',
      name: 'Application user',
      password: 'password-long-enough',
    });
    expect((await f.response(p.base + '/security', 'GET', undefined, app!.token)).status).toBe(401);
    const finding = first.findings.find((f) => f.code === 'ADMIN_MFA_GAP')!;
    const expiry = Date.now() + 86400000;
    expect(
      (
        await f.response(
          p.base + '/security/' + finding.id + '/acknowledge',
          'POST',
          { expiresAt: expiry },
          readOnly,
        )
      ).status,
    ).toBe(403);
    expect((await client.acknowledge(finding.id, expiry)).data.acknowledgedUntil).toBe(expiry);
    expect(
      (await client.scan()).data.findings.find((f) => f.id === finding.id)!.acknowledgedUntil,
    ).toBe(expiry);
    expect(
      (
        await f.response(
          p.base + '/security/' + '0'.repeat(64) + '/acknowledge',
          'POST',
          { expiresAt: expiry, additional: [finding] },
          f.token,
        )
      ).status,
    ).toBe(409);
    await client.clear(finding.id);
    expect(
      (await client.scan()).data.findings.find((f) => f.id === finding.id)!.acknowledgedUntil,
    ).toBeNull();
    await client.acknowledge(finding.id, expiry);
    const backup = (await f.call(p.base + '/backups', 'POST', {}, f.token)).data;
    const restored = (
      await f.call(
        `/management/v1/projects/${p.id}/backups/${backup.id}/restore`,
        'POST',
        {},
        f.token,
      )
    ).data;
    expect(
      (
        await new ManagementClient(f.url, f.token).security(p.id, restored.branchId).scan()
      ).data.findings.find((f) => f.id === finding.id)!.acknowledgedUntil,
    ).toBeNull();
  } finally {
    await f.close();
  }
}, 30000);
test('credential age survives audit pruning, missing legacy provenance stays unknown and other projects are excluded', async () => {
  const f = await fixture();
  try {
    const p = await f.project('credential-age'),
      other = await f.project('other-age');
    const key = (
      await f.call(
        `/management/v1/projects/${p.id}/keys`,
        'POST',
        { scope: 'service', branch: p.branchId, tables: ['tasks'], methods: ['GET'] },
        f.token,
      )
    ).data;
    const timestamp = new Date(Date.now() - 91 * 86400000).toISOString();
    await f.service.db
      .query('UPDATE project_key_metadata SET created_at=? WHERE key_id=?')
      .run(timestamp, key.id);
    await f.service.db.query("DELETE FROM audit_events WHERE action='key.create'").run();
    const scan = (await new ManagementClient(f.url, f.token).security(p.id, p.branchId).scan())
      .data;
    expect(scan.findings.find((f) => f.code === 'AGING_CREDENTIAL')!.resource).toBe(
      'key:' + key.id,
    );
    expect(scan.findings.find((f) => f.code === 'AGING_CREDENTIAL')!.evidence[0]).toContain(
      timestamp,
    );
    expect(
      (
        await new ManagementClient(f.url, f.token).security(other.id, other.branchId).scan()
      ).data.findings.some((f) => f.resource === 'key:' + key.id),
    ).toBe(false);
    await f.service.db.query('DELETE FROM project_key_metadata WHERE key_id=?').run(key.id);
    expect(
      (
        await new ManagementClient(f.url, f.token).security(p.id, p.branchId).scan()
      ).data.findings.some((f) => f.code === 'CREDENTIAL_AGE_UNKNOWN'),
    ).toBe(true);
  } finally {
    await f.close();
  }
}, 30000);
