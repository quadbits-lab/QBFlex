import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { expose, initializeBranch } from '@qb-flex/schema';
import { compileQuery } from '@qb-flex/query-engine';
import { BranchEngine } from '../packages/database/src/engine';
import { QueryInspector } from '../packages/database/src/query-inspector';
import { ownership } from './helpers';

test('query inspector stores redacted fingerprints and plans generated SELECT statements', async () => {
  const db = new Database(':memory:');
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'query-inspector-secret').initialize();
    await engine.migration(
      '001',
      'CREATE TABLE notes(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1)',
      'test',
    );
    await expose(db, 'notes', true, ['id', 'owner_id', 'title', 'revision']);
    await engine.savePolicy({
      resource: 'notes',
      operation: 'select',
      roles: ['authenticated'],
      mode: 'permissive',
      using: ownership,
      check: ownership,
      enabled: true,
    });
    await engine.mutate(
      'notes',
      'insert',
      { id: 'a', owner_id: 'alice', title: 'keep me' },
      { sub: null, role: 'anonymous' },
      undefined,
      undefined,
      true,
    );
    await engine.refresh();
    const table = engine.table('notes');
    const policy = engine.policy(table, 'select', { sub: 'alice', role: 'authenticated', roles: [] });
    const compiled = compileQuery(table, { limit: 10 }, policy);
    const inspector = await new QueryInspector(engine).initialize();
    const indexesBefore = (
      (await db
        .query(
          `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='notes' ORDER BY 1`,
        )
        .all()) as { indexname: string }[]
    ).map((row) => row.indexname);

    const recorded = await inspector.recordSample({
      table: 'notes',
      fingerprint: `${compiled.sql} AND owner_id = 'alice-secret-value'`,
      durationMs: 4.2,
      planSql: compiled.sql,
    });
    expect(recorded.table).toBe('notes');
    expect(recorded.operation).toBe('select');
    expect(recorded.durationMs).toBe(4);
    expect(recorded.count).toBe(1);
    expect(recorded.fingerprint).not.toContain('alice-secret-value');
    expect(recorded.fingerprint).not.toContain("'");
    const again = await inspector.recordSample({
      table: 'notes',
      fingerprint: recorded.fingerprint,
      durationMs: 8,
      planSql: compiled.sql,
    });
    expect(again.id).toBe(recorded.id);
    expect(again.count).toBe(2);

    const planned = await inspector.plan(`${compiled.sql} AND owner_id = 'alice-secret-value'`);
    expect(planned.state).toBe('planned');
    expect(planned.id).toBe(recorded.id);
    expect(planned.error).toBeNull();
    expect(planned.fingerprint).not.toContain('alice-secret-value');
    expect(planned.plan).toBeTruthy();
    expect(JSON.stringify(planned.plan)).toContain('Seq Scan');
    expect(JSON.stringify(planned.plan)).not.toContain('alice-secret-value');
    expect(JSON.stringify(planned.plan)).not.toContain('__qb_plan__');
    expect(planned.suggestions).toEqual([]);
    const indexesAfter = (
      (await db
        .query(
          `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='notes' ORDER BY 1`,
        )
        .all()) as { indexname: string }[]
    ).map((row) => row.indexname);
    expect(indexesAfter).toEqual(indexesBefore);
    expect(await db.query('SELECT count(*) AS n FROM notes').get()).toMatchObject({ n: 1 });

    const hostile = await inspector.recordSample({
      table: 'notes',
      fingerprint: 'delete notes where id = ?',
      durationMs: 1,
      planSql: 'DELETE FROM notes WHERE id = ?',
    });
    const failed = await inspector.plan(hostile.fingerprint);
    expect(failed.state).toBe('failed');
    expect(failed.plan).toBeNull();
    expect(failed.suggestions).toEqual([]);
    expect(failed.error).toBeTruthy();
    expect(await db.query('SELECT count(*) AS n FROM notes').get()).toMatchObject({ n: 1 });

    const shape = (index: number) => {
      let value = index;
      let token = '';
      do {
        token = String.fromCharCode(97 + (value % 26)) + token;
        value = Math.floor(value / 26);
      } while (value > 0);
      return `shape-${token}`;
    };
    for (let index = 0; index < 205; index++)
      await inspector.recordSample({
        table: 'notes',
        fingerprint: shape(index),
        durationMs: 1,
        planSql: compiled.sql,
      });
    const samples = await inspector.listSamples();
    expect(samples).toHaveLength(200);
    expect(samples.some((sample) => sample.fingerprint.includes('alice-secret'))).toBe(false);
    expect(JSON.stringify(samples)).not.toContain('alice-secret-value');
  } finally {
    await db.close();
  }
});
