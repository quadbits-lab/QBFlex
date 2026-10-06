import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLease } from '../packages/database/src/lease';
import { openDatabase } from '@qb-flex/database';
import { initializeBranch, expose, savePolicy } from '@qb-flex/schema';
import { BranchEngine } from '../packages/database/src/engine';
import { log } from '@qb-flex/observability';
test('OS-managed ownership rejects a live peer and recovers a SIGKILL without stale-lock races', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-lease-'));
  const child = Bun.spawn(['bun', 'tests/fixtures-lease.ts', dir], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  try {
    const reader = child.stdout.getReader();
    const result = await reader.read();
    expect(new TextDecoder().decode(result.value)).toContain('LEASED');
    expect(() => acquireLease(dir)).toThrow('Another API process');
    child.kill('SIGKILL');
    await child.exited;
    const release = acquireLease(dir);
    expect(() => acquireLease(dir)).toThrow();
    release();
    const next = acquireLease(dir);
    next();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('out-of-band DDL fails closed until a reviewed migration reconciles it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-stale-')),
    db = openDatabase(join(dir, 'main.sqlite'));
  try {
    initializeBranch(db);
    const engine = new BranchEngine(db, 'test');
    engine.migration(
      '001',
      'CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL);',
      'test',
    );
    expose(db, 'tasks', true, ['id', 'title']);
    savePolicy(db, {
      resource: 'tasks',
      operation: 'select',
      roles: ['anonymous'],
      mode: 'permissive',
      using: { op: 'true' },
      check: { op: 'true' },
      enabled: true,
    });
    expect(engine.read('tasks', {}, { sub: null, role: 'anonymous' }).data).toEqual([]);
    db.exec('ALTER TABLE tasks ADD COLUMN sensitive TEXT');
    expect(() => engine.read('tasks', {}, { sub: null, role: 'anonymous' })).toThrow(
      'Physical schema changed',
    );
    engine.migration('002-reconcile', 'CREATE INDEX tasks_title ON tasks(title);', 'reviewer');
    expect(engine.read('tasks', {}, { sub: null, role: 'anonymous' }).data).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('structured logging drops unknown credential and payload fields at runtime', () => {
  const original = console.log;
  let text = '';
  console.log = (value) => {
    text = String(value);
  };
  try {
    log({
      action: 'test',
      password: 'secret-password',
      authorization: 'Bearer secret',
      payload: { private: true },
    } as any);
  } finally {
    console.log = original;
  }
  expect(JSON.parse(text).action).toBe('test');
  expect(text).not.toContain('secret');
  expect(text).not.toContain('private');
});
