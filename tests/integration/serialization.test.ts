import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@qb-flex/database';
import { initializeBranch, expose, savePolicy } from '@qb-flex/schema';
import { BranchEngine } from '../../packages/database/src/engine';
test('typed wire values preserve 64-bit integers, binary keys, JSON, enum metadata and injection strings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-wire-')),
    db = openDatabase(join(directory, 'main.sqlite'));
  try {
    initializeBranch(db);
    const engine = new BranchEngine(db, 'test');
    engine.migration(
      '001',
      "CREATE TABLE documents(id BLOB PRIMARY KEY NOT NULL,amount INTEGER NOT NULL,payload BLOB,metadata JSON,state TEXT NOT NULL CHECK(state IN('todo','done')),title TEXT NOT NULL);",
      'test',
    );
    expose(db, 'documents', true, ['id', 'amount', 'payload', 'metadata', 'state', 'title']);
    for (const operation of ['select', 'insert', 'update', 'delete'] as const)
      savePolicy(db, {
        resource: 'documents',
        operation,
        roles: ['anonymous'],
        mode: 'permissive',
        using: { op: 'true' },
        check: { op: 'true' },
        enabled: true,
      });
    const identity = { sub: null, role: 'anonymous' } as const;
    const row = {
      id: 'AQID',
      amount: '9223372036854775807',
      payload: 'BAUG',
      metadata: '{"ok":true}',
      state: 'todo',
      title: "'; DROP TABLE documents; --",
    };
    expect(engine.mutate('documents', 'insert', row, identity).data[0]).toEqual(row);
    expect(
      engine.read('documents', { filters: [{ column: 'id', op: 'eq', value: 'AQID' }] }, identity)
        .data[0],
    ).toEqual(row);
    expect(engine.types()).toContain('"todo" | "done"');
    expect(() =>
      engine.mutate(
        'documents',
        'insert',
        { ...row, id: 'Bw==', amount: '9223372036854775808' },
        identity,
      ),
    ).toThrow('signed 64-bit');
    expect(() =>
      engine.mutate('documents', 'insert', { ...row, id: 'Bw==', payload: 'invalid!' }, identity),
    ).toThrow('canonical base64');
    expect(() =>
      engine.mutate('documents', 'insert', { ...row, id: 'Bw==', metadata: 'invalid' }, identity),
    ).toThrow('valid JSON');
    const after = engine.latest();
    engine.mutate('documents', 'delete', {}, identity, 'AQID');
    expect(engine.events(after, identity, 'documents').events[0].payload).toEqual({ id: 'AQID' });
    db.exec("INSERT INTO documents VALUES(x'07',1,zeroblob(400000),'{}','todo','Large');");
    expect(() => engine.read('documents', {}, identity)).toThrow('Result exceeds');
    expect(engine.read('documents', { columns: ['id', 'title'] }, identity).data).toEqual([
      { id: 'Bw==', title: 'Large' },
    ]);
    expect(() => engine.events(after + 1, identity, 'documents')).toThrow('fetch a fresh snapshot');
  } finally {
    db.close(true);
    rmSync(directory, { recursive: true, force: true });
  }
});
test('permissive policy grants are ORed and restrictive policies remain an AND boundary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-policy-')),
    db = openDatabase(join(directory, 'main.sqlite'));
  try {
    initializeBranch(db);
    const engine = new BranchEngine(db, 'test');
    engine.migration(
      '001',
      'CREATE TABLE tasks(id INTEGER PRIMARY KEY,owner_id TEXT NOT NULL,shared INTEGER NOT NULL,title TEXT NOT NULL);',
      'test',
    );
    expose(db, 'tasks', true, ['id', 'owner_id', 'shared', 'title']);
    db.exec(
      "INSERT INTO tasks VALUES(1,'alice',0,'Owned'),(2,'bob',1,'Shared'),(3,'alice',1,'Blocked');",
    );
    const rules = [
      {
        mode: 'permissive',
        using: { op: 'eq', left: { column: 'owner_id' }, right: { claim: 'sub' } },
      },
      { mode: 'permissive', using: { op: 'eq', left: { column: 'shared' }, right: { value: 1 } } },
      {
        mode: 'restrictive',
        using: { op: 'ne', left: { column: 'title' }, right: { value: 'Blocked' } },
      },
    ];
    for (const rule of rules)
      savePolicy(db, {
        resource: 'tasks',
        operation: 'select',
        roles: ['authenticated'],
        check: { op: 'true' },
        enabled: true,
        ...rule,
      } as any);
    expect(
      engine.read('tasks', { count: true }, { sub: 'alice', role: 'authenticated' }).meta.count,
    ).toBe(2);
    expect(engine.read('tasks', {}, { sub: null, role: 'anonymous' }).data).toEqual([]);
    expect(
      engine.read(
        'tasks',
        { filters: [{ column: 'title', op: 'eq', value: "'; DROP TABLE tasks;--" }] },
        { sub: 'alice', role: 'authenticated' },
      ).data,
    ).toEqual([]);
    expect(() =>
      engine.read(
        'tasks',
        { filters: [{ column: 'title) OR 1=1--', op: 'eq', value: 'x' }] },
        { sub: 'alice', role: 'authenticated' },
      ),
    ).toThrow('Unknown or hidden filter');
  } finally {
    db.close(true);
    rmSync(directory, { recursive: true, force: true });
  }
});
