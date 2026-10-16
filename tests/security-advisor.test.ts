import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { initializeBranch, expose } from '@qb-flex/schema';
import { BranchEngine } from '../packages/database/src/engine';
import { SecurityAdvisor } from '../packages/database/src/security-advisor';
test('advisor uses metadata only, distinguishes fail-closed grants from public exposure and makes no repairs', async () => {
  const db = new Database(':memory:', { safeIntegers: true });
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'isolated-advisor-key').initialize();
    await engine.migration(
      '001',
      'CREATE TABLE records(id TEXT PRIMARY KEY,secret_token TEXT,title TEXT);CREATE TABLE private_records(id TEXT PRIMARY KEY,password TEXT);',
      'test',
    );
    await expose(db, 'records', true, ['id', 'secret_token', 'title']);
    await db
      .query('INSERT INTO records VALUES(?,?,?)')
      .run('id', 'row-secret-canary', 'row-title-canary');
    await db
      .query('INSERT INTO _qb_buckets VALUES(?,?,?,?,?)')
      .run('bucket', 'public-files', 'public-read', 10000, '[]');
    const advisor = await new SecurityAdvisor(engine).initialize();
    const baseline = await advisor.scan();
    expect(baseline.findings.filter((f) => f.code === 'MISSING_GRANT')).toHaveLength(4);
    expect(baseline.findings.some((f) => f.code === 'SENSITIVE_COLUMN_EXPOSURE')).toBe(true);
    expect(baseline.findings.some((f) => f.code === 'PUBLIC_BUCKET')).toBe(true);
    expect(JSON.stringify(baseline)).not.toMatch(
      /row-secret-canary|row-title-canary|private_records/,
    );
    expect(await db.query('SELECT secret_token FROM records').get()).toEqual({
      secret_token: 'row-secret-canary',
    });
    expect(
      (await engine.read('records', { limit: 10 }, { sub: null, role: 'anonymous' })).data,
    ).toEqual([]);
    await engine.savePolicy({
      resource: 'records',
      operation: 'select',
      roles: ['anonymous'],
      mode: 'permissive',
      using: { op: 'true' },
      check: { op: 'true' },
      enabled: true,
    });
    expect(
      (await advisor.scan()).findings.find((f) => f.code === 'BROAD_ANONYMOUS_GRANT')!.severity,
    ).toBe('high');
    await engine.savePolicy({
      resource: 'records',
      operation: 'select',
      roles: ['anonymous'],
      mode: 'restrictive',
      using: { op: 'false' },
      check: { op: 'false' },
      enabled: true,
    });
    expect(
      (await advisor.scan()).findings.find((f) => f.code === 'BROAD_ANONYMOUS_GRANT')!.severity,
    ).toBe('medium');
    expect(
      (await engine.read('records', { limit: 10 }, { sub: null, role: 'anonymous' })).data,
    ).toEqual([]);
  } finally {
    await db.close();
  }
});
test('finding evidence binds acknowledgment; exact expiry, stale findings, invalid schedules and clearing are enforced', async () => {
  const db = new Database(':memory:', { safeIntegers: true });
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'isolated-advisor-key').initialize();
    await engine.migration(
      '001',
      'CREATE TABLE records(id TEXT PRIMARY KEY,secret_token TEXT,secret_password TEXT);',
      'test',
    );
    await expose(db, 'records', true, ['id', 'secret_token']);
    let now = 1000000;
    const advisor = await new SecurityAdvisor(engine, () => now).initialize(),
      finding = (await advisor.scan()).findings.find(
        (f) => f.code === 'SENSITIVE_COLUMN_EXPOSURE',
      )!;
    const expires = now + 86400000;
    expect((await advisor.acknowledge(finding.id, expires, 'admin')).acknowledgedUntil).toBe(
      expires,
    );
    expect(
      (await advisor.scan()).findings.find((f) => f.id === finding.id)!.acknowledgedUntil,
    ).toBe(expires);
    await expose(db, 'records', true, ['id', 'secret_token', 'secret_password']);
    expect(
      (await advisor.scan()).findings.find((f) => f.code === finding.code)!.acknowledgedUntil,
    ).toBeNull();
    await expect(
      (async () => await advisor.acknowledge(finding.id, expires, 'admin'))(),
    ).rejects.toThrow('changed or was resolved');
    await expose(db, 'records', true, ['id', 'secret_token']);
    now = expires - 1;
    expect(
      (await advisor.scan()).findings.find((f) => f.id === finding.id)!.acknowledgedUntil,
    ).toBe(expires);
    now++;
    expect(
      (await advisor.scan()).findings.find((f) => f.id === finding.id)!.acknowledgedUntil,
    ).toBeNull();
    await expect(
      (async () => await advisor.acknowledge(finding.id, now, 'admin'))(),
    ).rejects.toThrow('30 days');
    await expect(
      (async () => await advisor.acknowledge(finding.id, now + 30 * 86400000 + 1, 'admin'))(),
    ).rejects.toThrow('30 days');
    await advisor.acknowledge(finding.id, now + 1000, 'admin');
    expect(await advisor.clear(finding.id)).toEqual({ cleared: true });
    expect(
      (await advisor.scan()).findings.find((f) => f.id === finding.id)!.acknowledgedUntil,
    ).toBeNull();
  } finally {
    await db.close();
  }
});
test('advisor respects INSERT check-only semantics and role-scoped restrictions', async () => {
  const db = new Database(':memory:', { safeIntegers: true });
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'isolated-advisor-phase-key').initialize();
    await engine.migration('001', 'CREATE TABLE records(id TEXT PRIMARY KEY,title TEXT);', 'test');
    await expose(db, 'records', true, ['id', 'title']);
    await engine.savePolicy({
      resource: 'records',
      operation: 'insert',
      roles: ['anonymous'],
      mode: 'permissive',
      using: { op: 'false' },
      check: { op: 'true' },
      enabled: true,
    });
    await engine.savePolicy({
      resource: 'records',
      operation: 'insert',
      roles: ['authenticated'],
      mode: 'restrictive',
      using: { op: 'false' },
      check: { op: 'false' },
      enabled: true,
    });
    // Actual INSERT authorization uses prospective-row checks, not old-row USING.
    await engine.mutate(
      'records',
      'insert',
      { id: 'anonymous-write', title: 'Allowed' },
      { sub: null, role: 'anonymous' },
    );
    const report = await (await new SecurityAdvisor(engine).initialize()).scan();
    expect(
      report.findings.some((f) => f.code === 'UNREACHABLE_GRANT' && f.resource.endsWith(':insert')),
    ).toBe(false);
    expect(
      report.findings.find(
        (f) => f.code === 'BROAD_ANONYMOUS_GRANT' && f.resource.endsWith(':insert'),
      )?.severity,
    ).toBe('high');
  } finally {
    await db.close();
  }
});
