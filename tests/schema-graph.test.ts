import { test, expect } from 'bun:test';
import { buildSchemaGraph } from '../apps/studio/src/schema-graph';
const table = (name: string, columns: any[] = [], foreignKeys: any[] = [], exposed = true) =>
  ({ name, columns, foreignKeys, exposed, allowedColumns: columns.map((c) => c.name), indexes: [] });
test('builds nodes per table and edges per foreign key', () => {
  const graph = buildSchemaGraph([
    table('users', [{ name: 'id' }]),
    table('tasks', [{ name: 'id' }, { name: 'owner_id' }], [
      { table: 'users', from: 'owner_id', to: 'id' },
    ]),
  ]);
  expect(graph.nodes.length).toBe(2);
  expect(graph.edges.length).toBe(1);
  expect(graph.edges[0]!.source).toBe('tasks');
  expect(graph.edges[0]!.target).toBe('users');
  expect(graph.edges[0]!.label).toBe('owner_id');
  expect(graph.missing).toEqual([]);
});
test('references to absent tables surface as missing, not edges', () => {
  const graph = buildSchemaGraph([
    table('tasks', [], [{ table: 'teams', from: 'team_id', to: 'id' }]),
  ]);
  expect(graph.edges).toEqual([]);
  expect(graph.missing).toEqual(['teams']);
});
test('non-exposed tables still render (policy state is data, not structure)', () => {
  const graph = buildSchemaGraph([table('secret', [], [], false)]);
  expect(graph.nodes.length).toBe(1);
});
test('duplicate foreign keys dedupe; relationships become labeled edges', () => {
  const fk = { table: 'users', from: 'owner_id', to: 'id' };
  const graph = buildSchemaGraph([
    table('users', [{ name: 'id' }]),
    { ...table('tasks', [], [fk, fk]), relationships: [{ target: 'users' }] } as any,
  ]);
  expect(graph.edges.length).toBe(2);
  expect(graph.edges.filter((e) => e.label === 'relationship')).toHaveLength(1);
});
