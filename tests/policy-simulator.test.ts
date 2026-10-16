import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { initializeBranch, expose } from '@qb-flex/schema';
import { BranchEngine } from '../packages/database/src/engine';
import { simulatePolicy } from '../packages/database/src/policy-simulator';
import { ownership } from './helpers';
test('synthetic SELECT/INSERT/UPDATE/DELETE use DOUBLE PRECISION policies, never production rows or outbox', async () => {
  const db = new Database(':memory:');
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'isolated-simulator-secret').initialize();
    await engine.migration(
      '001',
      'CREATE TABLE tasks(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,title TEXT NOT NULL,revision BIGINT NOT NULL DEFAULT 1,hidden TEXT)',
      'test',
    );
    await expose(db, 'tasks', true, ['id', 'owner_id', 'title', 'revision']);
    for (const operation of ['select', 'insert', 'update', 'delete'] as const)
      await engine.savePolicy({
        resource: 'tasks',
        operation,
        roles: ['authenticated'],
        mode: 'permissive',
        using: ownership,
        check: ownership,
        enabled: true,
      });
    await engine.mutate(
      'tasks',
      'insert',
      { id: 'production', owner_id: 'alice', title: 'never copied', hidden: 'private' },
      { sub: null, role: 'anonymous' },
      undefined,
      undefined,
      true,
    );
    const before = await db.query('SELECT * FROM tasks ORDER BY id').all();
    const base = {
      table: 'tasks',
      identity: { sub: 'alice', role: 'authenticated' as const },
      fixtures: {
        tasks: [
          { id: 'a', owner_id: 'alice', title: 'own', hidden: 'not exposed' },
          { id: 'b', owner_id: 'bob', title: 'other' },
        ],
      },
    };
    const read = await simulatePolicy(engine, { ...base, operation: 'select' });
    expect(read.data).toEqual([{ id: 'a', owner_id: 'alice', title: 'own', revision: 1 }]);
    const denied = await simulatePolicy(engine, {
      ...base,
      operation: 'update',
      key: 'a',
      input: { owner_id: 'bob' },
    });
    expect(denied.allowed).toBe(false);
    expect(denied.oldRowAccess).toBe(true);
    expect(denied.prospectiveRowCheck).toBe(false);
    const forbidden = await simulatePolicy(engine, { ...base, operation: 'delete', key: 'b' });
    expect(forbidden.allowed).toBe(false);
    expect(forbidden.oldRowAccess).toBe(false);
    expect(
      (await simulatePolicy(engine, { ...base, operation: 'delete', key: 'a', revision: 1 }))
        .allowed,
    ).toBe(true);
    expect(
      (
        await simulatePolicy(engine, {
          ...base,
          operation: 'insert',
          input: { id: 'new', owner_id: 'bob', title: 'bad' },
        })
      ).allowed,
    ).toBe(false);
    expect(
      (
        await simulatePolicy(engine, {
          ...base,
          operation: 'insert',
          input: { id: 'new', owner_id: 'alice', title: 'ok' },
        })
      ).allowed,
    ).toBe(true);
    expect(
      (
        await simulatePolicy(engine, {
          ...base,
          operation: 'update',
          key: 'a',
          input: { hidden: 'no' },
        })
      ).allowed,
    ).toBe(false);
    expect(await db.query('SELECT * FROM tasks ORDER BY id').all()).toEqual(before);
    await expect(
      (async () =>
        await simulatePolicy(engine, {
          ...base,
          operation: 'select',
          identity: { sub: 'alice', role: 'service' },
        }))(),
    ).rejects.toThrow();
    await expect(
      (async () =>
        await simulatePolicy(engine, {
          ...base,
          operation: 'select',
          fixtures: { _qb_jobs: [] },
        }))(),
    ).rejects.toThrow();
    await expect(
      (async () =>
        await simulatePolicy(engine, {
          ...base,
          operation: 'select',
          fixtures: { tasks: Array.from({ length: 1001 }, (_, i) => ({ id: String(i) })) },
        }))(),
    ).rejects.toThrow('1,000');
  } finally {
    await db.close();
  }
});
