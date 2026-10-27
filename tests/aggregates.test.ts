import { test, expect } from 'bun:test';
import { compileQuery } from '../packages/query-engine/src/index';
import { TableSchema } from '../packages/contracts/src/index';
import { createHmac } from 'node:crypto';

const secret = 'test-secret-for-cursor';
const codec = (secret: string) => {
  const sign = (v: string) => createHmac('sha256', secret).update(v).digest('base64url');
  return { scope: (t: string, q: any, i: any, v: number) => sign(JSON.stringify({ engine: 'pglite-v1', table: t, query: { ...q, cursor: undefined }, identity: i, version: v })) };
};

const table: TableSchema = {
  name: 'tasks',
  columns: [
    { name: 'id', type: 'TEXT', nullable: false, default: null, primaryKey: 1, enum: [] },
    { name: 'owner_id', type: 'TEXT', nullable: false, default: null, primaryKey: 0, enum: [] },
    { name: 'title', type: 'TEXT', nullable: false, default: null, primaryKey: 0, enum: [] },
    { name: 'completed', type: 'BIGINT', nullable: false, default: '0', primaryKey: 0, enum: [] },
    { name: 'revision', type: 'BIGINT', nullable: false, default: '1', primaryKey: 0, enum: [] },
    { name: 'internal_note', type: 'TEXT', nullable: true, default: null, primaryKey: 0, enum: [] },
  ],
  exposed: true,
  allowedColumns: ['id', 'owner_id', 'title', 'completed', 'revision', 'internal_note'],
  indexes: [],
  foreignKeys: [],
  relationships: [],
};

const policy = { sql: 'TRUE', params: [] };
const identity = { sub: 'user-1', role: 'authenticated' as const, roles: [] };

test('compileQuery: basic count aggregate', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [{ alias: 'task_count', fn: 'count' as const }],
  };
  const compiled = compileQuery(table, q, policy);
  expect(compiled.sql).toContain('SELECT "owner_id",COUNT(*) AS "task_count"');
  expect(compiled.sql).toContain('FROM "tasks"');
  expect(compiled.sql).toContain('GROUP BY "owner_id"');
  expect(compiled.sql).toContain('LIMIT ?');
  expect(compiled.aggregates).toEqual(q.aggregates);
  expect(compiled.groupBy).toEqual(['owner_id']);
  expect(compiled.order).toEqual([]);
});

test('compileQuery: sum/avg/min/max with numeric column', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [
      { alias: 'sum_completed', fn: 'sum' as const, column: 'completed' },
      { alias: 'avg_completed', fn: 'avg' as const, column: 'completed' },
      { alias: 'min_completed', fn: 'min' as const, column: 'completed' },
      { alias: 'max_completed', fn: 'max' as const, column: 'completed' },
    ],
  };
  const compiled = compileQuery(table, q, policy);
  expect(compiled.sql).toContain('SUM("completed") AS "sum_completed"');
  expect(compiled.sql).toContain('AVG("completed") AS "avg_completed"');
  expect(compiled.sql).toContain('MIN("completed") AS "min_completed"');
  expect(compiled.sql).toContain('MAX("completed") AS "max_completed"');
});

test('compileQuery: countDistinct aggregate', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [{ alias: 'distinct_titles', fn: 'countDistinct' as const, column: 'title' }],
  };
  const compiled = compileQuery(table, q, policy);
  expect(compiled.sql).toContain('COUNT(DISTINCT "title") AS "distinct_titles"');
});

test('compileQuery: having clause', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [{ alias: 'task_count', fn: 'count' as const }],
    having: [{ alias: 'task_count', op: 'gt' as const, value: 5 }],
  };
  const compiled = compileQuery(table, q, policy);
  expect(compiled.sql).toContain('WHERE "task_count" > ?');
  expect(compiled.sql).toContain('AS "qb_having"');
  expect(compiled.params).toContain(5);
});

test('compileQuery: multiple having clauses', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [
      { alias: 'cnt', fn: 'count' as const },
      { alias: 'sum_c', fn: 'sum' as const, column: 'completed' },
    ],
    having: [
      { alias: 'cnt', op: 'gte' as const, value: 1 },
      { alias: 'sum_c', op: 'lt' as const, value: 100 },
    ],
  };
  const compiled = compileQuery(table, q, policy);
  expect(compiled.sql).toContain('WHERE "cnt" >= ? AND "sum_c" < ?');
  expect(compiled.sql).toContain('AS "qb_having"');
  expect(compiled.params).toContain(1);
  expect(compiled.params).toContain(100);
});

test('compileQuery: rejects cursor with aggregates', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [{ alias: 'c', fn: 'count' as const }],
    cursor: 'abc',
  };
  expect(() => compileQuery(table, q, policy)).toThrow('Cursor pagination not supported with aggregates');
});

test('compileQuery: rejects relations with aggregates', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [{ alias: 'c', fn: 'count' as const }],
    relations: [{ name: 'rel', columns: ['id'], limit: 10 }],
  };
  expect(() => compileQuery(table, q, policy)).toThrow('Relations not supported with aggregates');
});

test('compileQuery: rejects order with aggregates', () => {
  const q = {
    groupBy: ['owner_id'],
    aggregates: [{ alias: 'c', fn: 'count' as const }],
    order: [{ column: 'owner_id', direction: 'asc' as const }],
  };
  expect(() => compileQuery(table, q, policy)).toThrow('Order not supported with aggregates');
});

test('compileQuery: validates groupBy column allowlist', () => {
  const q = { groupBy: ['nonexistent'], aggregates: [{ alias: 'c', fn: 'count' as const }] };
  expect(() => compileQuery(table, q, policy)).toThrow('Unknown or hidden groupBy column');
});

test('compileQuery: validates aggregate column allowlist', () => {
  const q = { groupBy: ['owner_id'], aggregates: [{ alias: 'c', fn: 'sum' as const, column: 'nonexistent' }] };
  expect(() => compileQuery(table, q, policy)).toThrow('Unknown or hidden aggregate column');
});

test('compileQuery: sum/avg require numeric column', () => {
  const q = { groupBy: ['owner_id'], aggregates: [{ alias: 'c', fn: 'sum' as const, column: 'title' }] };
  expect(() => compileQuery(table, q, policy)).toThrow('sum requires a numeric column');
  const q2 = { groupBy: ['owner_id'], aggregates: [{ alias: 'c', fn: 'avg' as const, column: 'title' }] };
  expect(() => compileQuery(table, q2, policy)).toThrow('avg requires a numeric column');
});

test('compileQuery: validates aggregate bounds', () => {
  const manyGroupBy = { groupBy: ['owner_id', 'id', 'title', 'completed', 'revision', 'internal_note'], aggregates: [{ alias: 'c', fn: 'count' as const }] };
  expect(() => compileQuery(table, manyGroupBy, policy)).toThrow('Too many groupBy columns');
  const manyAgg = { groupBy: ['owner_id'], aggregates: Array.from({ length: 9 }, (_, i) => ({ alias: `a${i}`, fn: 'count' as const })) };
  expect(() => compileQuery(table, manyAgg, policy)).toThrow('Too many aggregates');
  const manyHaving = { groupBy: ['owner_id'], aggregates: [{ alias: 'c', fn: 'count' as const }], having: Array.from({ length: 11 }, (_, i) => ({ alias: 'c', op: 'eq' as const, value: i })) };
  expect(() => compileQuery(table, manyHaving, policy)).toThrow('Too many having clauses');
});

test('compileQuery: having alias must match aggregate alias', () => {
  const q = { groupBy: ['owner_id'], aggregates: [{ alias: 'cnt', fn: 'count' as const }], having: [{ alias: 'other', op: 'eq' as const, value: 1 }] };
  expect(() => compileQuery(table, q, policy)).toThrow('Having alias other must match an aggregate alias');
});

test('compileQuery: duplicate aggregate alias rejected', () => {
  const q = { groupBy: ['owner_id'], aggregates: [{ alias: 'cnt', fn: 'count' as const }, { alias: 'cnt', fn: 'sum' as const, column: 'completed' }] };
  expect(() => compileQuery(table, q, policy)).toThrow('Duplicate aggregate alias');
});

test('compileQuery: cursorCodec scope includes query shape', () => {
  const scope1 = codec(secret).scope('t', { groupBy: ['a'], aggregates: [{ alias: 'c', fn: 'count' }] }, identity, 1);
  const scope2 = codec(secret).scope('t', { groupBy: ['a', 'b'], aggregates: [{ alias: 'c', fn: 'count' }] }, identity, 1);
  expect(scope1).not.toBe(scope2);
});
