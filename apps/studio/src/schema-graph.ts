import type { TableSchema } from '@qb-flex/contracts';

export interface SchemaNodeData {
  table: TableSchema;
  [key: string]: unknown;
}
export interface SchemaGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface SchemaGraph {
  nodes: { id: string; data: SchemaNodeData }[];
  edges: SchemaGraphEdge[];
  missing: string[];
}

/**
 * Builds the visualizer graph from a branch schema response. Each table becomes
 * a node; each foreign key becomes an edge from the referencing table to the
 * referenced table. References to tables absent from the schema (e.g.
 * registered external relationships) surface in `missing` instead of breaking
 * the graph.
 */
export function buildSchemaGraph(tables: TableSchema[]): SchemaGraph {
  const names = new Set(tables.map((t) => t.name));
  const nodes = tables.map((table) => ({ id: table.name, data: { table } }));
  const edges: SchemaGraphEdge[] = [];
  const seen = new Set<string>();
  const missing = new Set<string>();
  for (const table of tables) {
    for (const fk of (table.foreignKeys ?? []) as any[]) {
      const target = fk.table;
      if (!target) continue;
      if (!names.has(target)) {
        missing.add(target);
        continue;
      }
      const id = `${table.name}:${fk.from}->${target}:${fk.to ?? fk.from}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, source: table.name, target, label: fk.from });
    }
    for (const relationship of (table.relationships ?? []) as any[]) {
      const target = relationship?.target ?? relationship?.table;
      if (!target || !names.has(target)) continue;
      const id = `${table.name}:rel:${target}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, source: table.name, target, label: 'relationship' });
    }
  }
  return { nodes, edges, missing: [...missing] };
}
