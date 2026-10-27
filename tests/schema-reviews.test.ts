import { expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import { initializeBranch, expose } from '@qb-flex/schema';
import { BranchEngine } from '../packages/database/src/engine';
import {
  SchemaReviews,
  classifyDestructive,
} from '../packages/database/src/schema-reviews';

test('classifyDestructive flags drop and delete patterns', () => {
  expect(classifyDestructive('DROP TABLE tasks').some((f) => f.kind === 'drop_table')).toBe(true);
  expect(classifyDestructive('DELETE FROM tasks').some((f) => f.kind === 'delete_rows')).toBe(
    true,
  );
  expect(classifyDestructive('CREATE TABLE ok(id TEXT PRIMARY KEY)')).toEqual([]);
});

test('schema review rehearses, approves, and applies; stale digest is rejected', async () => {
  const db = new Database(':memory:');
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'review-secret').initialize();
    const reviews = await new SchemaReviews(engine).initialize();
    await engine.migration(
      '001',
      'CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL)',
      'test',
    );
    await expose(db, 'tasks', true, ['id', 'title']);
    const draft = await reviews.create(
      {
        migrationId: '002',
        sql: 'ALTER TABLE tasks ADD COLUMN owner_id TEXT',
      },
      'author',
    );
    expect(draft.state).toBe('draft');
    expect(draft.destructive).toEqual([]);
    const rehearsed = await reviews.rehearse(draft.id);
    expect(rehearsed.state).toBe('rehearsed');
    expect(rehearsed.typeCheckOk).toBe(true);
    const approved = await reviews.approve(draft.id);
    expect(approved.state).toBe('approved');
    const applied = await reviews.applyApproved(draft.id, 'author');
    expect('schemaVersion' in applied ? applied.schemaVersion : 0).toBeGreaterThan(1);
    expect((await reviews.get(draft.id)).state).toBe('applied');

    const other = await reviews.create(
      {
        migrationId: '003',
        sql: 'ALTER TABLE tasks ADD COLUMN note TEXT',
      },
      'author',
    );
    await reviews.rehearse(other.id);
    await reviews.approve(other.id);
    await engine.migration('side', 'ALTER TABLE tasks ADD COLUMN side TEXT', 'test');
    await expect(reviews.applyApproved(other.id, 'author')).rejects.toMatchObject({
      code: 'SCHEMA_STALE',
    });
  } finally {
    await db.close();
  }
});

test('live apply requires an approved review with matching digest', async () => {
  const db = new Database(':memory:');
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'review-secret-2').initialize();
    const reviews = await new SchemaReviews(engine).initialize();
    await expect(
      reviews.requireApproved('x', 'CREATE TABLE a(id TEXT PRIMARY KEY)'),
    ).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
  } finally {
    await db.close();
  }
});
