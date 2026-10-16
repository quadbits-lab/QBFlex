import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePolicies } from '@qb-flex/policies';
import { initializeBranch, expose, savePolicy } from '@qb-flex/schema';
import { openDatabase } from '@qb-flex/database';
import { BranchEngine } from '../packages/database/src/engine';
import { APP_ROLE_NAME, isReservedRoleName } from '@qb-flex/contracts';

test('compilePolicies matches system role or assigned app roles', () => {
  const policies = [
    {
      resource: 'tasks',
      operation: 'select' as const,
      roles: ['editor'],
      mode: 'permissive' as const,
      enabled: true,
      using: { op: 'true' as const },
      check: { op: 'true' as const },
    },
    {
      resource: 'tasks',
      operation: 'select' as const,
      roles: ['authenticated'],
      mode: 'permissive' as const,
      enabled: true,
      using: { op: 'false' as const },
      check: { op: 'false' as const },
    },
  ];
  const denied = compilePolicies(policies, 'tasks', 'select', [], {
    sub: 'u1',
    role: 'authenticated',
    roles: [],
  });
  expect(denied.sql).toContain('FALSE');
  const granted = compilePolicies(policies, 'tasks', 'select', [], {
    sub: 'u1',
    role: 'authenticated',
    roles: ['editor'],
  });
  expect(granted.sql).not.toBe('FALSE');
  expect(granted.sql).toContain('TRUE');
});

test('role name validation reserves system policy roles', () => {
  expect(isReservedRoleName('authenticated')).toBe(true);
  expect(isReservedRoleName('editor')).toBe(false);
  expect(APP_ROLE_NAME.test('editor')).toBe(true);
  expect(APP_ROLE_NAME.test('Editor')).toBe(false);
  expect(APP_ROLE_NAME.test('1bad')).toBe(false);
});

test('custom role policies and banned-style deny via missing app role', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-rbac-'));
  const db = openDatabase(join(dir, 'main.pglite'));
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'rbac-test-secret').initialize();
    await engine.migration(
      '001',
      'CREATE TABLE notes(id TEXT PRIMARY KEY,title TEXT NOT NULL);',
      'test',
    );
    await expose(db, 'notes', true, ['id', 'title']);
    await db
      .query('INSERT INTO _qb_roles VALUES(?,?,?,?)')
      .run('role-editor', 'editor', 'Can read notes', new Date().toISOString());
    await savePolicy(db, {
      resource: 'notes',
      operation: 'select',
      roles: ['editor'],
      mode: 'permissive',
      enabled: true,
      using: { op: 'true' },
      check: { op: 'true' },
    });
    await engine.refresh();
    await db.query('INSERT INTO notes VALUES(?,?)').run('1', 'Hello');
    expect(
      (await engine.read('notes', {}, { sub: 'alice', role: 'authenticated', roles: [] })).data,
    ).toEqual([]);
    expect(
      (await engine.read('notes', {}, { sub: 'alice', role: 'authenticated', roles: ['editor'] }))
        .data,
    ).toEqual([{ id: '1', title: 'Hello' }]);
    await expect(
      savePolicy(db, {
        resource: 'notes',
        operation: 'insert',
        roles: ['missing_role'],
        mode: 'permissive',
        enabled: true,
        using: { op: 'true' },
        check: { op: 'true' },
      }),
    ).rejects.toThrow();
  } finally {
    await db.close(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
