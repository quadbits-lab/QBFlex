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
test('related rows, existence policies, upsert paths and reviewed RPC share identity enforcement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-relations-'));
  const db = openDatabase(join(dir, 'main.pglite'));
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'test-secret').initialize();
    await engine.migration(
      '001',
      `CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),owner_id TEXT NOT NULL,title TEXT NOT NULL,revision BIGINT NOT NULL DEFAULT 1);`,
      'test',
    );
    await expose(db, 'projects', true, ['id', 'owner_id']);
    await expose(db, 'tasks', true, ['id', 'project_id', 'owner_id', 'title', 'revision']);
    for (const resource of ['projects', 'tasks'])
      for (const operation of ['select', 'insert', 'update', 'delete'] as const)
        await savePolicy(db, {
          resource,
          operation,
          roles: ['authenticated'],
          mode: 'permissive',
          using: ownership,
          check: ownership,
          enabled: true,
        });
    await registerRelationship(db, {
      name: 'tasks',
      source: 'projects',
      target: 'tasks',
      localColumn: 'id',
      foreignColumn: 'project_id',
      cardinality: 'many',
    });
    await registerRelationship(db, {
      name: 'project',
      source: 'tasks',
      target: 'projects',
      localColumn: 'project_id',
      foreignColumn: 'id',
      cardinality: 'one',
    });
    const alice = { sub: 'alice', role: 'authenticated' } as const,
      bob = { sub: 'bob', role: 'authenticated' } as const;
    await engine.mutate('projects', 'insert', { id: 'p', owner_id: 'alice' }, alice);
    await engine.mutate(
      'tasks',
      'insert',
      { id: 'a', project_id: 'p', owner_id: 'alice', title: 'Visible' },
      alice,
    );
    await engine.mutate(
      'tasks',
      'insert',
      { id: 'b', project_id: 'p', owner_id: 'bob', title: 'Private' },
      bob,
    );
    const related = (await engine.read('projects', { relations: [{ name: 'tasks' }] }, alice))
      .data[0].tasks as any[];
    expect(related.map((t) => t.id)).toEqual(['a']);
    expect(
      (await engine.read('tasks', { relations: [{ name: 'project' }] }, bob)).data[0].project,
    ).toBeNull();
    await engine.savePolicy({
      id: 'needs-parent',
      resource: 'tasks',
      operation: 'select',
      roles: ['authenticated'],
      mode: 'restrictive',
      enabled: true,
      using: { op: 'exists', relationship: 'project', where: { op: 'true' } },
      check: { op: 'true' },
    });
    expect((await engine.read('tasks', { count: true }, bob)).meta.count).toBe(0);
    expect((await engine.read('tasks', {}, alice)).data.length).toBe(1);
    await expect(
      (async () =>
        await engine.mutate(
          'tasks',
          'upsert',
          { id: 'a', project_id: 'p', owner_id: 'bob', title: 'Take over' },
          bob,
        ))(),
    ).rejects.toThrow();
    await expect(
      (async () =>
        await engine.mutate(
          'tasks',
          'upsert',
          { id: 'a', project_id: 'p', owner_id: 'bob', title: 'Reassign' },
          alice,
        ))(),
    ).rejects.toThrow();
    await engine.mutate(
      'tasks',
      'upsert',
      { id: 'a', project_id: 'p', owner_id: 'alice', title: 'Changed' },
      alice,
    );
    expect((await engine.read('tasks', {}, alice)).data[0].revision).toBe(2);
    await registerRPC(db, {
      name: 'rename_task',
      table: 'tasks',
      kind: 'update',
      args: { id: 'string', title: 'string' },
      keyArg: 'id',
      values: { title: { arg: 'title' } },
    });
    await engine.rpc('rename_task', { id: 'a', title: 'RPC' }, alice, 'rpc-1');
    expect((await engine.read('tasks', {}, alice)).data[0].title).toBe('RPC');
    await expect(
      (async () => await engine.rpc('rename_task', { id: 'a', title: 'Stolen' }, bob))(),
    ).rejects.toThrow();
    await expect(
      (async () =>
        await engine.rpc(
          'rename_task',
          { id: 'a', title: 'Bad', sql: 'DROP TABLE tasks' },
          alice,
        ))(),
    ).rejects.toThrow();
    expect(await engine.types()).toContain('"rename_task"');
  } finally {
    await db.close(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
test('outbox preserves large BIGINT precision and replay expiry requires resynchronization', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qb-serialize-'));
  const db = openDatabase(join(dir, 'main.pglite'));
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'test').initialize();
    await engine.migration(
      '001',
      'CREATE TABLE values_test(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,bytes BYTEA,amount BIGINT);',
      'test',
    );
    await expose(db, 'values_test', true, ['id', 'bytes', 'amount']);
    await savePolicy(db, {
      resource: 'values_test',
      operation: 'select',
      roles: ['anonymous'],
      mode: 'permissive',
      using: { op: 'true' },
      check: { op: 'true' },
      enabled: true,
    });
    await db.exec("INSERT INTO values_test VALUES(1,decode('CAFE','hex'),9223372036854775807);");
    const identity = { sub: null, role: 'anonymous' } as const;
    expect((await engine.read('values_test', {}, identity)).data[0]).toEqual({
      id: 1,
      bytes: 'yv4=',
      amount: '9223372036854775807',
    });
    expect((await engine.events(0, identity)).events[0].payload).toEqual({
      id: 1,
      bytes: 'yv4=',
      amount: '9223372036854775807',
    });
    await db.exec("INSERT INTO _qb_meta VALUES('outbox_floor','1'); DELETE FROM _qb_outbox;");
    expect(await engine.latest()).toBe(1);
    await expect((async () => await engine.events(0, identity))()).rejects.toThrow(
      'Replay window expired',
    );
  } finally {
    await db.close(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
