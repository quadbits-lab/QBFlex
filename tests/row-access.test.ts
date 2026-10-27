import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { initializeBranch, expose } from '@qb-flex/schema';
import { BranchEngine } from '../packages/database/src/engine';
import { evaluateRowAccess } from '../packages/database/src/row-access';
import { ownership } from './helpers';

test('row access reports select visibility, update/delete using checks, and exposed columns', async () => {
  const db = new Database(':memory:');
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'row-access-secret').initialize();
    await engine.migration(
      '001',
      'CREATE TABLE tasks(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,title TEXT NOT NULL,revision BIGINT NOT NULL DEFAULT 1,hidden TEXT)',
      'test',
    );
    const allowed = ['id', 'owner_id', 'title', 'revision'];
    await expose(db, 'tasks', true, allowed);
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
      { id: 'row-1', owner_id: 'alice', title: 'secret', hidden: 'private' },
      { sub: null, role: 'anonymous' },
      undefined,
      undefined,
      true,
    );
    const before = await db.query('SELECT * FROM tasks').all();
    const [owner, other, anonymous] = await evaluateRowAccess(engine, {
      table: 'tasks',
      key: 'row-1',
      identities: [
        { sub: 'alice', role: 'authenticated' },
        { sub: 'bob', role: 'authenticated', roles: ['member'] },
        { sub: null, role: 'anonymous' },
      ],
    });
    expect(owner).toEqual({
      identity: { sub: 'alice', role: 'authenticated' },
      select: true,
      insert: null,
      update: true,
      delete: true,
      columns: allowed,
    });
    expect(other).toMatchObject({
      select: false,
      insert: null,
      update: false,
      delete: false,
      columns: [],
    });
    expect(anonymous).toMatchObject({ select: false, insert: null, columns: [] });
    expect(await db.query('SELECT * FROM tasks').all()).toEqual(before);
    await expect(
      evaluateRowAccess(engine, { table: 'tasks', key: 'missing', identities: [] }),
    ).rejects.toThrow('Row not found');
    await expect(
      evaluateRowAccess(engine, {
        table: 'tasks',
        key: 'row-1',
        identities: Array.from({ length: 11 }, () => ({ sub: 'alice', role: 'authenticated' as const })),
      }),
    ).rejects.toThrow('10 identities');
  } finally {
    await db.close();
  }
});
