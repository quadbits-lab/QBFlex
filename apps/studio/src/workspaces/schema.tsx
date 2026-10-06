import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { Map, KeyRound } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  Loading,
  Notice,
  Skeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  WorkflowCanvas,
  cn,
} from '@qb-flex/ui';
import { management } from '../api';
import { ErrorMessage } from './shared';
import type { TableSchema } from '@qb-flex/contracts';
import { buildSchemaGraph } from '../schema-graph';

type TableFlowNode = Node<
  { table: TableSchema; selected: boolean; vertical: boolean },
  'schemaTable'
>;

function SchemaTableNode({ data, selected }: NodeProps<TableFlowNode>) {
  const { table, selected: isSelected, vertical } = data;
  return (
    <div
      role="group"
      aria-label={`Table ${table.name}, ${table.columns.length} columns, ${table.exposed ? 'exposed' : 'private'}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          (event.target as HTMLElement).click();
        }
      }}
      className={cn(
        'w-56 cursor-pointer rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow focus-visible:outline-2 focus-visible:outline-ring',
        isSelected ? 'border-ring ring-2 ring-ring/40 shadow-md' : 'border-border hover:shadow-md',
      )}
      data-selected={isSelected || undefined}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        isConnectable={false}
      />
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="font-mono truncate text-[0.8125rem] font-semibold">{table.name}</span>
        <Badge variant={table.exposed ? 'success' : 'default'}>
          {table.exposed ? 'exposed' : 'private'}
        </Badge>
      </div>
      <ul
        className="max-h-40 overflow-y-auto px-0 py-1 text-2xs"
        aria-label={`${table.name} columns`}
      >
        {table.columns.slice(0, 12).map((c) => (
          <li
            key={c.name}
            className="flex items-center justify-between gap-2 px-3 py-0.5 hover:bg-muted/50"
          >
            <span className="font-mono truncate text-foreground/90">
              <span className="sr-only">{c.primaryKey ? 'Primary key: ' : ''}</span>
              {!!c.primaryKey && <KeyRound className="mr-1 inline size-3" aria-hidden="true" />}
              {c.name}
            </span>
            <span className="text-muted-foreground">{c.type.toLowerCase()}</span>
          </li>
        ))}
        {table.columns.length > 12 && (
          <li className="px-3 py-0.5 text-muted-foreground">+{table.columns.length - 12} more…</li>
        )}
      </ul>
    </div>
  );
}

const nodeTypes = { schemaTable: SchemaTableNode };

export function SchemaVisualizer({ base }: { base: string }) {
  const schema = useQuery({
    queryKey: ['schema', base],
    queryFn: () =>
      management.request<{ tables: TableSchema[]; schemaVersion: number }>(base + '/schema'),
  });
  const policies = useQuery({
    queryKey: ['policies', base],
    queryFn: () => management.request<any[]>(base + '/policies'),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const tables = schema.data?.data.tables ?? [];
  const { nodes, edges, missing } = useMemo(() => buildSchemaGraph(tables), [tables]);
  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'schemaTable',
        position: { x: 0, y: 0 },
        data: { table: n.data.table, selected: selected === n.id, vertical: true },
      })),
    [nodes, selected],
  );
  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        type: 'alignedStep' as const,
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
        labelStyle: { fill: 'var(--muted-foreground)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--card)' },
        ariaLabel: e.label
          ? `${e.source} references ${e.target} through column ${e.label}`
          : `${e.source} references ${e.target}`,
      })),
    [edges],
  );
  const selectedTable = tables.find((t) => t.name === selected);
  if (schema.isPending)
    return (
      <div className="grid grid-cols-1 gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  if (schema.error)
    return (
      <>
        <ErrorMessage error={schema.error} />
        <Empty title="Unable to load schema">Refresh or select another project.</Empty>
      </>
    );
  return (
    <div className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid grid-cols-1 size-9 place-items-center rounded-lg border border-border bg-card">
            <Map size={18} aria-hidden="true" className="text-muted-foreground" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Schema visualizer</h2>
            <p className="text-sm text-muted-foreground">
              Tables and foreign keys for the selected branch · schema v
              {schema.data?.data.schemaVersion}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="list" aria-label="Legend">
          <Badge variant="success" role="listitem">
            exposed
          </Badge>
          <Badge role="listitem">private</Badge>
          <Badge variant="outline" role="listitem">
            ⟶ foreign key
          </Badge>
        </div>
      </div>
      {!tables.length ? (
        <Empty title="Nothing to visualize yet">
          Apply a migration to create tables, then revisit this page for the topology map.
        </Empty>
      ) : (
        <Card className="min-h-0 flex-1 overflow-hidden p-0">
          <div className="h-full w-full">
            <WorkflowCanvas
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              vertical
              nodeSep={60}
              rankSep={90}
              selectedId={selected}
              onSelectNode={(id) => setSelected(id)}
              showMiniMap
            />
          </div>
        </Card>
      )}
      {!!missing.length && (
        <Notice>
          Edges reference tables outside this schema:{' '}
          <span className="font-mono">{missing.join(', ')}</span>
        </Notice>
      )}
      <Sheet open={!!selectedTable} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetTitle>
            <span className="font-mono">{selectedTable?.name}</span>
          </SheetTitle>
          <SheetDescription>
            {selectedTable?.exposed
              ? `Exposed through REST · allowed columns: ${selectedTable?.allowedColumns.length}/${selectedTable?.columns.length}`
              : 'Private table — protected by policies until exposed.'}
          </SheetDescription>
          {selectedTable && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Constraints</TableHead>
                    <TableHead>API access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTable.columns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono">
                        <span className="sr-only">{c.primaryKey ? 'Primary key: ' : ''}</span>
                        {!!c.primaryKey && (
                          <KeyRound className="mr-1 inline size-3" aria-hidden="true" />
                        )}
                        {c.name}
                      </TableCell>
                      <TableCell className="font-mono">{c.type}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[
                          c.primaryKey && 'primary key',
                          !c.nullable && 'not null',
                          c.generated && 'generated',
                          c.default !== null && `default ${c.default}`,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {selectedTable.allowedColumns.includes(c.name) ? 'Allowed' : 'Hidden'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="text-sm">
                <p className="font-medium">Row policies</p>
                {policies.isPending ? (
                  <Loading />
                ) : policies.error ? (
                  <ErrorMessage error={policies.error} />
                ) : (
                  <pre className="mt-2 max-h-48 overflow-auto">
                    {JSON.stringify(
                      (policies.data?.data ?? []).filter(
                        (p: any) => p.resource === selectedTable.name,
                      ),
                      null,
                      2,
                    )}
                  </pre>
                )}
                <p className="font-medium">Indexes</p>
                <pre className="mt-2 max-h-40 overflow-auto">
                  {JSON.stringify(selectedTable.indexes ?? [], null, 2)}
                </pre>
                <p className="mt-3 font-medium">Foreign keys</p>
                <pre className="mt-2 max-h-40 overflow-auto">
                  {JSON.stringify(selectedTable.foreignKeys ?? [], null, 2)}
                </pre>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
