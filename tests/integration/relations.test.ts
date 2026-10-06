import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@qb-flex/database';
import {
  initializeBranch,
  expose,
  savePolicy,
  registerRelationship,
  registerRPC,
} from '@qb-flex/schema';
import { BranchEngine } from '../../packages/database/src/engine';
const ownership = { op: 'eq', left: { column: 'owner_id' }, right: { claim: 'sub' } } as const;
test('related rows, existence policies, upsert paths and reviewed RPC share identity enforcement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-relations-'));
  const db = openDatabase(join(dir, 'main.sqlite'));
  try {
    initializeBranch(db);
    const engine = new BranchEngine(db, 'test-secret');
    engine.migration(
      '001',
      `CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),owner_id TEXT NOT NULL,title TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);`,
      'test',
    );
    expose(db, 'projects', true, ['id', 'owner_id']);
    expose(db, 'tasks', true, ['id', 'project_id', 'owner_id', 'title', 'revision']);
    for (const resource of ['projects', 'tasks'])
      for (const operation of ['select', 'insert', 'update', 'delete'] as const)
        savePolicy(db, {
          resource,
          operation,
          roles: ['authenticated'],
          mode: 'permissive',
          using: ownership,
          check: ownership,
          enabled: true,
        });
    registerRelationship(db, {
      name: 'tasks',
      source: 'projects',
      target: 'tasks',
      localColumn: 'id',
      foreignColumn: 'project_id',
      cardinality: 'many',
    });
    registerRelationship(db, {
      name: 'project',
      source: 'tasks',
      target: 'projects',
      localColumn: 'project_id',
      foreignColumn: 'id',
      cardinality: 'one',
    });
    const alice = { sub: 'alice', role: 'authenticated' } as const,
      bob = { sub: 'bob', role: 'authenticated' } as const;
    engine.mutate('projects', 'insert', { id: 'p', owner_id: 'alice' }, alice);
    engine.mutate(
      'tasks',
      'insert',
      { id: 'a', project_id: 'p', owner_id: 'alice', title: 'Visible' },
      alice,
    );
    engine.mutate(
      'tasks',
      'insert',
      { id: 'b', project_id: 'p', owner_id: 'bob', title: 'Private' },
      bob,
    );
    const related = engine.read('projects', { relations: [{ name: 'tasks' }] }, alice).data[0]
      .tasks as any[];
    expect(related.map((t) => t.id)).toEqual(['a']);
    expect(
      engine.read('tasks', { relations: [{ name: 'project' }] }, bob).data[0].project,
    ).toBeNull();
    engine.savePolicy({
      id: 'needs-parent',
      resource: 'tasks',
      operation: 'select',
      roles: ['authenticated'],
      mode: 'restrictive',
      enabled: true,
      using: { op: 'exists', relationship: 'project', where: { op: 'true' } },
      check: { op: 'true' },
    });
    expect(engine.read('tasks', { count: true }, bob).meta.count).toBe(0);
    expect(engine.read('tasks', {}, alice).data.length).toBe(1);
    expect(() =>
      engine.mutate(
        'tasks',
        'upsert',
        { id: 'a', project_id: 'p', owner_id: 'bob', title: 'Take over' },
        bob,
      ),
    ).toThrow();
    expect(() =>
      engine.mutate(
        'tasks',
        'upsert',
        { id: 'a', project_id: 'p', owner_id: 'bob', title: 'Reassign' },
        alice,
      ),
    ).toThrow();
    engine.mutate(
      'tasks',
      'upsert',
      { id: 'a', project_id: 'p', owner_id: 'alice', title: 'Changed' },
      alice,
    );
    expect(engine.read('tasks', {}, alice).data[0].revision).toBe(2);
    registerRPC(db, {
      name: 'rename_task',
      table: 'tasks',
      kind: 'update',
      args: { id: 'string', title: 'string' },
      keyArg: 'id',
      values: { title: { arg: 'title' } },
    });
    engine.rpc('rename_task', { id: 'a', title: 'RPC' }, alice, 'rpc-1');
    expect(engine.read('tasks', {}, alice).data[0].title).toBe('RPC');
    expect(() => engine.rpc('rename_task', { id: 'a', title: 'Stolen' }, bob)).toThrow();
    expect(() =>
      engine.rpc('rename_task', { id: 'a', title: 'Bad', sql: 'DROP TABLE tasks' }, alice),
    ).toThrow();
    expect(engine.types()).toContain('"rename_task"');
  } finally {
    db.close(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
test('outbox preserves large integer precision and replay expiry requires resynchronization', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-serialize-'));
  const db = openDatabase(join(dir, 'main.sqlite'));
  try {
    initializeBranch(db);
    const engine = new BranchEngine(db, 'test');
    engine.migration(
      '001',
      'CREATE TABLE values_test(id INTEGER PRIMARY KEY,bytes BLOB,amount INTEGER);',
      'test',
    );
    expose(db, 'values_test', true, ['id', 'bytes', 'amount']);
    savePolicy(db, {
      resource: 'values_test',
      operation: 'select',
      roles: ['anonymous'],
      mode: 'permissive',
      using: { op: 'true' },
      check: { op: 'true' },
      enabled: true,
    });
    db.exec("INSERT INTO values_test VALUES(1,X'CAFE',9223372036854775807);");
    const identity = { sub: null, role: 'anonymous' } as const;
    expect(engine.read('values_test', {}, identity).data[0]).toEqual({
      id: 1,
      bytes: 'yv4=',
      amount: '9223372036854775807',
    });
    expect(engine.events(0, identity).events[0].payload).toEqual({
      id: 1,
      bytes: 'yv4=',
      amount: '9223372036854775807',
    });
    db.exec("INSERT INTO _qb_meta VALUES('outbox_floor','1'); DELETE FROM _qb_outbox;");
    expect(engine.latest()).toBe(1);
    expect(() => engine.events(0, identity)).toThrow('Replay window expired');
  } finally {
    db.close(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
