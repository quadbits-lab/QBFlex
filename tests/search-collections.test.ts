import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { expose, initializeBranch } from '@qb-flex/schema';
import { BranchEngine } from '../packages/database/src/engine';
import { SearchCollections } from '../packages/database/src/search';
import { ownership } from './helpers';

const anonymous = { sub: null, role: 'anonymous' as const, roles: [] as string[] };
const alice = { sub: 'alice', role: 'authenticated' as const, roles: [] as string[] };
const bob = { sub: 'bob', role: 'authenticated' as const, roles: [] as string[] };

async function notesFixture() {
  const db = new Database(':memory:');
  await initializeBranch(db);
  const engine = await new BranchEngine(db, 'search-collections-secret').initialize();
  await engine.migration(
    '001',
    `CREATE TABLE notes(
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      secret TEXT,
      revision BIGINT NOT NULL DEFAULT 1)`,
    'test',
  );
  await expose(db, 'notes', true, ['id', 'owner_id', 'title', 'body', 'revision']);
  for (const operation of ['select', 'insert', 'update', 'delete'] as const)
    await engine.savePolicy({
      resource: 'notes',
      operation,
      roles: ['authenticated'],
      mode: 'permissive',
      using: ownership,
      check: ownership,
      enabled: true,
    });
  await engine.mutate(
    'notes',
    'insert',
    {
      id: 'a',
      owner_id: 'alice',
      title: 'alice zephyr sharedword',
      body: 'only alice',
      secret: 'hidden-alice-token',
    },
    anonymous,
    undefined,
    undefined,
    true,
  );
  await engine.mutate(
    'notes',
    'insert',
    {
      id: 'b1',
      owner_id: 'bob',
      title: 'bob sharedword one',
      body: 'only bob',
      secret: 'hidden-bob-token',
    },
    anonymous,
    undefined,
    undefined,
    true,
  );
  await engine.mutate(
    'notes',
    'insert',
    {
      id: 'b2',
      owner_id: 'bob',
      title: 'bob sharedword two',
      body: 'also bob',
      secret: 'hidden-bob-two',
    },
    anonymous,
    undefined,
    undefined,
    true,
  );
  const search = await new SearchCollections(engine).initialize();
  return { db, engine, search };
}

test('search applies SELECT ownership to hits, counts, snippets and projected columns', async () => {
  const { db, engine, search } = await notesFixture();
  try {
    await expect(
      search.create({ name: 'secrets', table: 'notes', columns: ['secret'] }),
    ).rejects.toThrow('exposed');
    await expect(
      search.create({ name: 'revisions', table: 'notes', columns: ['revision'] }),
    ).rejects.toThrow('text');
    const created = await search.create({ name: 'notes', table: 'notes', columns: ['title', 'body'] });
    expect(created.state).toBe('ready');
    expect(created.table).toBe('notes');
    expect(created.columns).toEqual(['title', 'body']);
    await expect(
      search.create({ name: 'notes', table: 'notes', columns: ['title'] }),
    ).rejects.toThrow('already exists');

    const hidden = await search.search(engine, bob, { collection: 'notes', q: 'zephyr' });
    expect(hidden.hits).toEqual([]);
    expect(hidden.count).toBe(0);
    expect(hidden.cursor).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain('alice');
    expect(JSON.stringify(hidden)).not.toContain('hidden-');

    const owned = await search.search(engine, alice, { collection: 'notes', q: 'zephyr' });
    expect(owned.count).toBe(1);
    expect(owned.hits.map((hit) => hit.id)).toEqual(['a']);
    expect(owned.hits[0]?.table).toBe('notes');
    expect(owned.hits[0]?.snippet).toContain('zephyr');
    expect(owned.hits[0]?.row).toMatchObject({
      id: 'a',
      owner_id: 'alice',
      title: 'alice zephyr sharedword',
    });
    expect(owned.hits[0]?.row).not.toHaveProperty('secret');
    expect(JSON.stringify(owned)).not.toContain('hidden-alice-token');

    const first = await search.search(engine, bob, { collection: 'notes', q: 'sharedword', limit: 1 });
    expect(first.count).toBe(2);
    expect(first.hits).toHaveLength(1);
    expect(['b1', 'b2']).toContain(first.hits[0]?.id);
    expect(JSON.stringify(first)).not.toContain('alice');
    expect(JSON.stringify(first)).not.toContain('hidden-');
    if (!first.cursor) throw new Error('Expected a search cursor');
    const second = await search.search(engine, bob, {
      collection: 'notes',
      q: 'sharedword',
      limit: 1,
      cursor: first.cursor,
    });
    expect(second.hits).toHaveLength(1);
    expect(second.hits[0]?.id).not.toBe(first.hits[0]?.id);
    expect(['b1', 'b2']).toContain(second.hits[0]?.id);
    expect(second.cursor).toBeNull();
    expect(JSON.stringify(second)).not.toContain('alice');
    expect(JSON.stringify(second)).not.toContain('hidden-');

    await expect(
      search.search(engine, bob, { collection: 'notes', q: 'x'.repeat(201) }),
    ).rejects.toThrow('200');
    await expect(search.search(engine, bob, { collection: 'notes', q: 'sharedword', limit: 51 })).rejects.toThrow(
      '50',
    );

    await search.invalidateForSchemaChange();
    expect((await search.list())[0]?.state).toBe('invalidated');
    await expect(search.search(engine, alice, { collection: 'notes', q: 'zephyr' })).rejects.toThrow(
      'invalidated',
    );
    expect((await search.rebuild(created.id)).state).toBe('ready');
    const rebuilt = await search.search(engine, alice, { collection: 'notes', q: 'zephyr' });
    expect(rebuilt.hits.map((hit) => hit.id)).toEqual(['a']);
    expect(rebuilt.count).toBe(1);

    await search.delete(created.id);
    expect(await search.list()).toEqual([]);
    await expect(search.search(engine, alice, { collection: 'notes', q: 'zephyr' })).rejects.toThrow(
      'not available',
    );
  } finally {
    await db.close();
  }
});
