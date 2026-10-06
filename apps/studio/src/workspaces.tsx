import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Plus,
  Play,
  Copy,
  Download,
  ShieldCheck,
  Database,
  Table2,
  Trash2,
  Pencil,
  Upload,
  KeyRound,
  GitBranch,
  Lock,
  Check,
  Columns3,
} from 'lucide-react';
import { Button, Badge, Notice, Loading, Empty, Modal } from '@qb-flex/ui';
import { management, docsURL, apiURL, raw } from './api';
import type { TableSchema } from '@qb-flex/contracts';
function useWrite() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      method = 'POST',
      body,
      headers,
    }: {
      path: string;
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    }) => management.request(path, method, body, undefined, headers),
    onSuccess: () => cache.invalidateQueries(),
  });
}
function ErrorMessage({ error }: { error: Error | null }) {
  return error ? <Notice kind="error">{error.message}</Notice> : null;
}
function download(content: string, name: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function JsonEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label>
      {label}
      <textarea
        className="mono json-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </label>
  );
}
const taskSQL = `CREATE TABLE tasks (\n  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),\n  owner_id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),\n  revision INTEGER NOT NULL DEFAULT 1\n);\nCREATE INDEX tasks_owner_idx ON tasks(owner_id);`;
export function DatabaseWorkspace({ base }: { base: string }) {
  const schema = useQuery({
    queryKey: ['schema', base],
    queryFn: () =>
      management.request<{ tables: TableSchema[]; schemaVersion: number }>(base + '/schema'),
  });
  const tables = schema.data?.data.tables ?? [];
  const [table, setTable] = useState(''),
    [tab, setTab] = useState('Data'),
    [dialog, setDialog] = useState(false);
  const selected = tables.find((t) => t.name === table);
  useEffect(() => {
    if (!tables.some((t) => t.name === table) && tables[0]) setTable(tables[0].name);
  }, [schema.data]);
  if (schema.isPending) return <Loading />;
  if (schema.error) return <ErrorMessage error={schema.error} />;
  return (
    <>
      <div className="database-layout">
        <aside className="table-sidebar">
          <div className="table-list-title">
            <span>TABLES</span>
            <button
              className="icon-button"
              aria-label="Create table"
              onClick={() => setDialog(true)}
            >
              <Plus size={16} />
            </button>
          </div>
          {tables.map((t) => (
            <button
              key={t.name}
              className={table === t.name ? 'selected' : ''}
              onClick={() => setTable(t.name)}
            >
              <Table2 size={15} />
              <span>{t.name}</span>
              {!t.exposed && <Lock size={12} />}
            </button>
          ))}
          <div className="table-security-note">
            <ShieldCheck size={17} />
            <p>
              Private until exposed.
              <br />
              Protected by policies.
            </p>
          </div>
        </aside>
        <div className="database-main">
          <div className="database-header">
            <div className="flex">
              <Database size={18} />
              <strong>{table || 'Database'}</strong>
              <Badge>schema v{schema.data?.data.schemaVersion}</Badge>
            </div>
            <Button variant="secondary" onClick={() => setDialog(true)}>
              <Plus size={15} /> New table
            </Button>
          </div>
          <nav className="workspace-tabs">
            {['Data', 'Schema', 'Policies', 'SQL', 'Migrations'].map((t) => (
              <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
          {tab === 'Data' &&
            (selected ? (
              <DataGrid base={base} table={selected} />
            ) : (
              <Empty title="No tables yet">
                Create a table or apply a migration to start working with data.
              </Empty>
            ))}
          {tab === 'Schema' && selected && <SchemaEditor base={base} table={selected} />}
          {tab === 'Policies' && selected && <PolicyEditor base={base} table={selected} />}
          {tab === 'SQL' && <SQLEditor base={base} />}
          {tab === 'Migrations' && <Migrations base={base} />}
        </div>
      </div>
      <TableDialog base={base} open={dialog} onClose={() => setDialog(false)} />
    </>
  );
}
function TableDialog({
  base,
  open,
  onClose,
}: {
  base: string;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('tasks'),
    [sql, setSQL] = useState(taskSQL),
    [error, setError] = useState('');
  const write = useWrite();
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Create a table"
      description="Apply a reviewed schema migration. The table starts private."
    >
      <label>
        Migration ID
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <JsonEditor label="SQLite schema" value={sql} onChange={setSQL} />
      {error && <Notice kind="error">{error}</Notice>}
      <Button
        disabled={write.isPending}
        onClick={async () => {
          try {
            await write.mutateAsync({
              path: base + '/migrations',
              body: { id: name + '_' + Date.now(), sql },
            });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {write.isPending ? 'Applying…' : 'Create table'}
      </Button>
    </Modal>
  );
}
function DataGrid({ base, table }: { base: string; table: TableSchema }) {
  const [cursor, setCursor] = useState<string | undefined>(),
    [filter, setFilter] = useState(''),
    [filterColumn, setFilterColumn] = useState(table.columns[0]?.name ?? ''),
    [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null),
    [visibility, setVisibility] = useState<VisibilityState>({}),
    [importDialog, setImportDialog] = useState(false),
    [importText, setImportText] = useState(''),
    [columnDialog, setColumnDialog] = useState(false),
    [rowDialog, setRowDialog] = useState(false),
    [edit, setEdit] = useState<any>(null),
    [values, setValues] = useState<Record<string, string>>({}),
    [nulls, setNulls] = useState<Record<string, boolean>>({}),
    [error, setError] = useState('');
  const parent = useRef<HTMLDivElement>(null);
  const write = useWrite();
  const filters = filter ? [{ column: filterColumn, op: 'like', value: `%${filter}%` }] : [];
  const params = new URLSearchParams({
    limit: '100',
    filters: JSON.stringify(filters),
    order: JSON.stringify(sort ? [sort] : []),
  });
  if (cursor) params.set('cursor', cursor);
  const rows = useQuery({
    queryKey: ['rows', base, table.name, cursor, filter, filterColumn, sort],
    queryFn: () => management.request<any[]>(base + '/data/' + table.name + '?' + params),
  });
  useEffect(() => {
    setCursor(undefined);
    setFilter('');
    setVisibility({});
    setSort(null);
    setFilterColumn(table.columns[0]?.name ?? '');
  }, [table.name]);
  const openRow = (row: any = null) => {
    setEdit(row);
    setError('');
    setValues(
      row
        ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? '' : String(v)]))
        : {},
    );
    setNulls(row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null])) : {});
    setRowDialog(true);
  };
  const key = (row: any) => {
    const values = table.columns
      .filter((c) => c.primaryKey)
      .sort((a, b) => a.primaryKey - b.primaryKey)
      .map((c) => row[c.name]);
    return values.length === 1
      ? String(values[0])
      : btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(values))))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
  };
  const columns: ColumnDef<any>[] = [
    ...table.columns.map((c) => ({
      accessorKey: c.name,
      header: () => (
        <button
          className="column-sort"
          onClick={() => {
            setCursor(undefined);
            setSort({
              column: c.name,
              direction: sort?.column === c.name && sort.direction === 'asc' ? 'desc' : 'asc',
            });
          }}
        >
          {c.primaryKey ? <KeyRound size={12} /> : null}
          {c.name}
          <small>{c.type.toLowerCase()}</small>
        </button>
      ),
      cell: ({ getValue }: any) =>
        getValue() === null ? (
          <span className="null-cell">null</span>
        ) : (
          <span>{String(getValue())}</span>
        ),
    })),
    {
      id: 'actions',
      header: '',
      cell: ({ row }: any) => (
        <div className="row-actions">
          <button aria-label="Edit row" onClick={() => openRow(row.original)}>
            <Pencil size={14} />
          </button>
          <button
            aria-label="Delete row"
            onClick={() => openRow({ ...row.original, __delete: true })}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];
  const grid = useReactTable({
    data: rows.data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
  });
  const gridRows = grid.getRowModel().rows;
  const virtual = useVirtualizer({
    count: gridRows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 45,
    overscan: 8,
  });
  const items = virtual.getVirtualItems();
  const save = async () => {
    setError('');
    try {
      if (edit?.__delete) {
        await write.mutateAsync({
          path: base + '/data/' + table.name + '/' + encodeURIComponent(key(edit)),
          method: 'DELETE',
        });
      } else {
        const row: any = {};
        for (const c of table.columns) {
          if (c.generated || (edit && c.primaryKey) || (c.name === 'revision' && edit)) continue;
          if (!(c.name in values) && !nulls[c.name]) continue;
          row[c.name] = nulls[c.name]
            ? null
            : /INT|REAL|FLOAT|DOUBLE|NUMERIC/i.test(c.type) &&
                values[c.name] !== '' &&
                Number.isSafeInteger(Number(values[c.name]))
              ? Number(values[c.name])
              : values[c.name];
        }
        await write.mutateAsync({
          path: base + '/data/' + table.name + (edit ? '/' + encodeURIComponent(key(edit)) : ''),
          method: edit ? 'PATCH' : 'POST',
          body: row,
        });
      }
      setRowDialog(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Modal
        open={importDialog}
        onOpenChange={setImportDialog}
        title="Import rows"
        description="Insert a maximum of 100 rows atomically using your organization permissions."
      >
        <JsonEditor label="JSON row array" value={importText} onChange={setImportText} />
        <label>
          Choose a JSON file
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              try {
                const file = event.target.files?.[0];
                if (file) {
                  if (file.size > 65536) throw new Error('Choose a file under 64 KiB');
                  setImportText(await file.text());
                }
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          />
        </label>
        <Button
          disabled={write.isPending || !importText}
          onClick={async () => {
            try {
              const rows = JSON.parse(importText);
              if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100)
                throw new Error('Provide 1–100 rows');
              await write.mutateAsync({
                path: base + '/data/' + table.name,
                body: rows,
                headers: { 'idempotency-key': crypto.randomUUID() },
              });
              setImportDialog(false);
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          Import rows
        </Button>
        {error && <Notice kind="error">{error}</Notice>}
      </Modal>
      <div className="data-toolbar">
        <div className="filter-controls">
          <select
            aria-label="Filter column"
            value={filterColumn}
            onChange={(e) => {
              setFilterColumn(e.target.value);
              setCursor(undefined);
            }}
          >
            {table.columns.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
          <input
            aria-label="Filter rows"
            placeholder="Filter rows…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setCursor(undefined);
            }}
          />
        </div>
        <div className="flex">
          <Button variant="ghost" onClick={() => setColumnDialog(true)}>
            <Columns3 size={15} /> Columns
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              download(
                JSON.stringify(rows.data?.data ?? [], null, 2),
                table.name + '.json',
                'application/json',
              )
            }
          >
            <Download size={15} /> Export page
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setImportDialog(true);
              setImportText('');
              setError('');
            }}
          >
            <Upload size={15} /> Import JSON
          </Button>
          <Button onClick={() => openRow()}>
            <Plus size={15} /> Insert row
          </Button>
        </div>
      </div>
      <ErrorMessage error={rows.error} />
      {rows.isPending ? (
        <Loading />
      ) : !gridRows.length ? (
        <Empty title="No matching rows">Insert a row or change the filter.</Empty>
      ) : (
        <div className="grid-scroll" ref={parent}>
          <table>
            <thead>
              {grid.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {items[0]?.start > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={columns.length} style={{ height: items[0].start, padding: 0 }} />
                </tr>
              )}
              {items.map((item) => {
                const row = gridRows[item.index]!;
                return (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {items.length > 0 && virtual.getTotalSize() - (items.at(-1)?.end ?? 0) > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length}
                    style={{
                      height: virtual.getTotalSize() - (items.at(-1)?.end ?? 0),
                      padding: 0,
                    }}
                  />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="data-footer">
        <span>
          {rows.data?.data.length ?? 0} rows on this page · {rows.data?.meta.count ?? '—'} total
        </span>
        <div className="flex">
          <Button variant="ghost" disabled={!cursor} onClick={() => setCursor(undefined)}>
            First page
          </Button>
          <Button
            variant="secondary"
            disabled={!rows.data?.meta.cursor}
            onClick={() => setCursor(rows.data?.meta.cursor)}
          >
            Next page
          </Button>
        </div>
      </div>
      <Modal open={columnDialog} onOpenChange={setColumnDialog} title="Visible columns">
        {grid
          .getAllLeafColumns()
          .filter((c) => c.id !== 'actions')
          .map((c) => (
            <label className="checkbox-label" key={c.id}>
              <input
                type="checkbox"
                checked={c.getIsVisible()}
                onChange={c.getToggleVisibilityHandler()}
              />
              {c.id}
            </label>
          ))}
      </Modal>
      <Modal
        open={rowDialog}
        onOpenChange={setRowDialog}
        title={edit?.__delete ? 'Delete row' : edit ? 'Edit row' : 'Insert row'}
        description={
          edit?.__delete
            ? 'This removes the selected row from the current branch.'
            : 'Values are validated by SQLite and the Management API.'
        }
      >
        {edit?.__delete ? (
          <p className="mono">{key(edit)}</p>
        ) : (
          table.columns
            .filter(
              (c) => !c.generated && !(edit && c.primaryKey) && !(edit && c.name === 'revision'),
            )
            .map((c) => (
              <label key={c.name}>
                {c.name}
                <small>
                  {c.type}
                  {c.default !== null ? ` · default ${c.default}` : ''}
                </small>
                <input
                  value={values[c.name] ?? ''}
                  disabled={nulls[c.name]}
                  onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
                />
                {c.nullable && (
                  <span className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!nulls[c.name]}
                      onChange={(e) => setNulls((v) => ({ ...v, [c.name]: e.target.checked }))}
                    />{' '}
                    Set null
                  </span>
                )}
              </label>
            ))
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <Button
          variant={edit?.__delete ? 'danger' : 'primary'}
          disabled={write.isPending}
          onClick={save}
        >
          {write.isPending ? 'Saving…' : edit?.__delete ? 'Delete row' : 'Save row'}
        </Button>
      </Modal>
    </>
  );
}
function SchemaEditor({ base, table }: { base: string; table: TableSchema }) {
  const write = useWrite();
  const [exposure, setExposure] = useState(table.exposed),
    [columns, setColumns] = useState(table.allowedColumns),
    [sql, setSQL] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    setExposure(table.exposed);
    setColumns(table.allowedColumns);
  }, [table.name, table.exposed]);
  return (
    <div className="workspace-body stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Columns</h2>
          <Badge>{table.columns.length}</Badge>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Default</th>
                <th>Key</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="mono">{c.type}</td>
                  <td>{c.nullable ? 'Yes' : 'No'}</td>
                  <td className="mono">{c.default ?? '—'}</td>
                  <td>{c.primaryKey ? 'Primary' : c.generated ? 'Generated' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>API exposure</h2>
          <Badge>{table.exposed ? 'Exposed' : 'Private'}</Badge>
        </div>
        <div className="panel-body">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={exposure}
              onChange={(e) => setExposure(e.target.checked)}
            />{' '}
            Enable public API routes
          </label>
          <p className="muted">
            Policies must grant access separately. Primary keys are required in the public
            projection.
          </p>
          <div className="column-checks">
            {table.columns.map((c) => (
              <label className="checkbox-label" key={c.name}>
                <input
                  type="checkbox"
                  checked={columns.includes(c.name)}
                  disabled={!!c.primaryKey}
                  onChange={(e) =>
                    setColumns((v) =>
                      e.target.checked ? [...v, c.name] : v.filter((n) => n !== c.name),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
          <Button
            disabled={write.isPending}
            onClick={async () => {
              try {
                await write.mutateAsync({
                  path: base + '/exposure/' + table.name,
                  method: 'PUT',
                  body: { enabled: exposure, columns },
                });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save exposure
          </Button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Indexes and relationships</h2>
        </div>
        <div className="panel-body">
          <pre>
            {JSON.stringify({ indexes: table.indexes, foreignKeys: table.foreignKeys }, null, 2)}
          </pre>
          <JsonEditor
            label="Schema migration for an index or relationship"
            value={sql}
            onChange={setSQL}
          />
          <Button
            disabled={!sql || write.isPending}
            onClick={async () => {
              try {
                await write.mutateAsync({
                  path: base + '/migrations',
                  body: { id: 'schema_' + Date.now(), sql },
                });
                setSQL('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Apply migration
          </Button>
        </div>
      </section>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
function PolicyEditor({ base, table }: { base: string; table: TableSchema }) {
  const ownership = { op: 'eq', left: { column: 'owner_id' }, right: { claim: 'sub' } };
  const [operation, setOperation] = useState('select'),
    [expression, setExpression] = useState(JSON.stringify(ownership, null, 2)),
    [role, setRole] = useState('authenticated'),
    [mode, setMode] = useState('permissive'),
    [subject, setSubject] = useState(''),
    [result, setResult] = useState(''),
    [error, setError] = useState('');
  const write = useWrite();
  const saved = useQuery({
    queryKey: ['policies', base],
    queryFn: () => management.request<any[]>(base + '/policies'),
  });
  return (
    <div className="workspace-body stack">
      <Notice>Without an applicable permissive grant, every public operation is denied.</Notice>
      <section className="panel">
        <div className="panel-head">
          <h2>Policies for {table.name}</h2>
          <Badge>{saved.data?.data.filter((p) => p.resource === table.name).length ?? 0}</Badge>
        </div>
        <div className="panel-body">
          {saved.data?.data
            .filter((p) => p.resource === table.name)
            .map((p) => (
              <div className="policy-row" key={p.id}>
                <ShieldCheck size={16} />
                <strong>{p.operation}</strong>
                <span className="muted">
                  {p.roles.join(', ')} · {p.mode}
                </span>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await write.mutateAsync({
                      path: base + '/policies',
                      method: 'PUT',
                      body: { ...p, enabled: !p.enabled },
                    });
                  }}
                >
                  {p.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            ))}
          <div className="form-columns">
            <label>
              Operation
              <select value={operation} onChange={(e) => setOperation(e.target.value)}>
                {['select', 'insert', 'update', 'delete'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option>authenticated</option>
                <option>anonymous</option>
              </select>
            </label>
            <label>
              Mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option>permissive</option>
                <option>restrictive</option>
              </select>
            </label>
          </div>
          <JsonEditor
            label="USING and WITH CHECK expression"
            value={expression}
            onChange={setExpression}
          />
          <Button
            disabled={write.isPending}
            onClick={async () => {
              try {
                const expr = JSON.parse(expression);
                await write.mutateAsync({
                  path: base + '/policies',
                  method: 'PUT',
                  body: {
                    resource: table.name,
                    operation,
                    roles: [role],
                    mode,
                    using: expr,
                    check: expr,
                    enabled: true,
                  },
                });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Create policy
          </Button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Test an application identity</h2>
        </div>
        <div className="panel-body">
          <label>
            Application user ID
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Use a real user ID or fixture subject"
            />
          </label>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const r = await management.request(base + '/policies/test', 'POST', {
                  table: table.name,
                  identity: { sub: subject || null, role: subject ? 'authenticated' : 'anonymous' },
                  query: { limit: 10, count: true },
                });
                setResult(JSON.stringify(r, null, 2));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Play size={15} /> Evaluate select
          </Button>
          {result && <pre>{result}</pre>}
        </div>
      </section>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
function SQLEditor({ base }: { base: string }) {
  const [sql, setSQL] = useState('SELECT 1 AS healthy;'),
    [result, setResult] = useState('');
  const write = useWrite();
  return (
    <div className="workspace-body">
      <Notice>
        SQL runs with developer privileges in the selected branch. Writes create a recovery snapshot
        first.
      </Notice>
      <JsonEditor label="SQLite SQL" value={sql} onChange={setSQL} />
      <Button
        disabled={write.isPending}
        onClick={async () => {
          const r = await write.mutateAsync({ path: base + '/sql', body: { sql } });
          setResult(JSON.stringify(r.data, null, 2));
        }}
      >
        <Play size={15} /> Run SQL
      </Button>
      <ErrorMessage error={write.error} />
      {result && <pre>{result}</pre>}
    </div>
  );
}
function Migrations({ base }: { base: string }) {
  const list = useQuery({
    queryKey: ['migrations', base],
    queryFn: () => management.request<any[]>(base + '/migrations'),
  });
  const [id, setID] = useState(''),
    [sql, setSQL] = useState('');
  const write = useWrite();
  return (
    <div className="workspace-body stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Migration history</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Applied</th>
                <th>Checksum</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.data.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>{new Date(m.applied_at).toLocaleString()}</td>
                  <td className="mono">{m.checksum.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel panel-body">
        <label>
          Migration ID
          <input value={id} onChange={(e) => setID(e.target.value)} placeholder="002_add_index" />
        </label>
        <JsonEditor label="SQL migration" value={sql} onChange={setSQL} />
        <Button
          disabled={!id || !sql || write.isPending}
          onClick={async () => {
            await write.mutateAsync({ path: base + '/migrations', body: { id, sql } });
            setID('');
            setSQL('');
          }}
        >
          Apply migration
        </Button>
        <ErrorMessage error={write.error} />
      </section>
    </div>
  );
}
export function AuthWorkspace({ base, project }: { base: string; project: any }) {
  const users = useQuery({
    queryKey: ['users', base],
    queryFn: () => management.request<any[]>(base + '/users'),
  });
  const write = useWrite();
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>Application users</h2>
          <Badge>Separate from platform accounts</Badge>
        </div>
        {users.isPending ? (
          <Loading />
        ) : users.error ? (
          <ErrorMessage error={users.error} />
        ) : !users.data?.data.length ? (
          <Empty title="No application users yet">
            Use the client SDK to register your first application user.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>User ID</th>
                  <th>Verified</th>
                  <th>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td className="mono">{u.id}</td>
                    <td>{u.emailVerified ? 'Yes' : 'No'}</td>
                    <td>
                      <Button
                        variant="ghost"
                        disabled={write.isPending}
                        onClick={() =>
                          write.mutate({
                            path: base + '/users/' + u.id + '/sessions',
                            method: 'DELETE',
                          })
                        }
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ProviderSettings project={project} />
      <ErrorMessage error={write.error} />
    </div>
  );
}
function ProviderSettings({ project }: { project: any }) {
  const config = useQuery({
    queryKey: ['config', project.id],
    queryFn: () => management.request(`/projects/${project.id}/config`),
  });
  const [provider, setProvider] = useState('github'),
    [clientId, setClientID] = useState(''),
    [secret, setSecret] = useState(''),
    [origins, setOrigins] = useState(''),
    [verify, setVerify] = useState(false);
  const write = useWrite();
  useEffect(() => {
    if (config.data) {
      setOrigins(config.data.data.origins.join('\n'));
      setVerify(config.data.data.verifyEmail);
    }
  }, [config.data]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Authentication configuration</h2>
        <Badge>{config.data?.data.providers?.length ?? 0} configured providers</Badge>
      </div>
      <div className="panel-body">
        <label className="checkbox-label">
          <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />{' '}
          Require email verification (SMTP required)
        </label>
        <label>
          Allowed application origins
          <textarea
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder="One exact origin per line"
          />
        </label>
        <Button
          variant="secondary"
          disabled={write.isPending}
          onClick={() =>
            write.mutate({
              path: `/projects/${project.id}/config`,
              method: 'PUT',
              headers: { 'if-match': String(config.data?.data.version) },
              body: {
                origins: origins
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
                verifyEmail: verify,
              },
            })
          }
        >
          Save auth settings
        </Button>
        <hr />
        <h3>Social provider</h3>
        <label>
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="github">GitHub</option>
            <option value="google">Google</option>
          </select>
        </label>
        <label>
          Client ID
          <input value={clientId} onChange={(e) => setClientID(e.target.value)} />
        </label>
        <label>
          Client secret
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <p className="muted">
          Credentials are encrypted and never shown again. Register the explicit branch callback URL
          with the provider.
        </p>
        <Button
          disabled={!clientId || !secret || write.isPending}
          onClick={async () => {
            await write.mutateAsync({
              path: `/projects/${project.id}/config`,
              method: 'PUT',
              headers: { 'if-match': String(config.data?.data.version) },
              body: { providers: { [provider]: { clientId, clientSecret: secret } } },
            });
            setSecret('');
            setClientID('');
          }}
        >
          Save provider
        </Button>
        <ErrorMessage error={write.error} />
      </div>
    </section>
  );
}
export function APIWorkspace({
  base,
  project,
  keyValue,
  setKeyValue,
}: {
  base: string;
  project: any;
  keyValue: string;
  setKeyValue: (v: string) => void;
}) {
  const keys = useQuery({
    queryKey: ['keys', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/keys`),
  });
  const write = useWrite();
  const [types, setTypes] = useState(''),
    [copied, setCopied] = useState(false);
  const endpoint = `${apiURL}/v1/projects/${project.id}/branches/primary`;
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Connect your application</h2>
          <Badge>REST v1</Badge>
        </div>
        <div className="panel-body">
          <label>
            API endpoint
            <input value={endpoint} readOnly />
          </label>
          <pre>{`import { createClient } from '@qb-flex/client';\n\nconst qb = createClient({\n  url: '${apiURL}',\n  projectId: '${project.id}',\n  branch: 'primary',\n  publishableKey: 'YOUR_PUBLISHABLE_KEY',\n});`}</pre>
          <div className="flex">
            <a className="button button-secondary" href={docsURL + '/docs/sdk/react/quickstart'}>
              React tutorial
            </a>
            <a className="button button-secondary" href={docsURL + '/docs/sdk/vanilla/quickstart'}>
              Vanilla JS tutorial
            </a>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Publishable keys</h2>
          <Button
            onClick={async () => {
              const result = await write.mutateAsync({
                path: `/projects/${project.id}/keys`,
                body: {},
              });
              setKeyValue(result.data.key);
            }}
          >
            <Plus size={15} /> Create key
          </Button>
        </div>
        <div className="panel-body">
          {keyValue && (
            <Notice>
              Copy this key now; its value is shown once.
              <div className="flex">
                <code className="key-value">{keyValue}</code>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(keyValue);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </Button>
              </div>
            </Notice>
          )}
          {keys.data?.data.map((k) => (
            <div className="policy-row" key={k.id}>
              <KeyRound size={15} />
              <code>{k.prefix}…</code>
              <Badge>{k.revoked_at ? 'Revoked' : 'Active'}</Badge>
              <Button
                variant="ghost"
                disabled={!!k.revoked_at}
                onClick={() =>
                  write.mutate({ path: `/projects/${project.id}/keys/${k.id}`, method: 'DELETE' })
                }
              >
                Revoke
              </Button>
            </div>
          ))}
          <p className="muted">
            Publishable keys identify this project. Policies determine data access.
          </p>
          <ErrorMessage error={write.error} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Generated TypeScript definitions</h2>
          <Button
            variant="secondary"
            onClick={async () => {
              const value = await management.text(base + '/types');
              setTypes(value);
              download(value, 'qb-flex.types.ts');
            }}
          >
            <Download size={15} /> Generate types
          </Button>
        </div>
        {types && (
          <div className="panel-body">
            <pre>{types}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
export function StorageWorkspace({ base }: { base: string }) {
  const buckets = useQuery({
    queryKey: ['buckets', base],
    queryFn: () => management.request<any[]>(base + '/buckets'),
  });
  const [dialog, setDialog] = useState(false),
    [name, setName] = useState(''),
    [visibility, setVisibility] = useState('private'),
    [size, setSize] = useState('10485760'),
    [mime, setMime] = useState('');
  const write = useWrite();
  const [selected, setSelected] = useState('');
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Storage buckets</h2>
          <Button onClick={() => setDialog(true)}>
            <Plus size={15} /> New bucket
          </Button>
        </div>
        <div className="panel-body">
          {buckets.isPending ? (
            <Loading />
          ) : !buckets.data?.data.length ? (
            <Empty title="No buckets yet">
              Create a bucket, then upload through an authenticated application client.
            </Empty>
          ) : (
            buckets.data.data.map((b) => (
              <button className="service-row" key={b.id} onClick={() => setSelected(b.id)}>
                <span className="service-icon">
                  <Database size={20} />
                </span>
                <div>
                  <strong>{b.name}</strong>
                  <small className="mono">{b.id}</small>
                </div>
                <Badge>{b.visibility}</Badge>
                <small>{Math.round(Number(b.max_size) / 1048576)} MiB limit</small>
              </button>
            ))
          )}
          <Notice>
            Uploads, downloads and object deletion use the application SDK with the current user’s
            ownership permissions.
          </Notice>
          <a className="button button-secondary" href={docsURL + '/docs/storage/files'}>
            Storage guide
          </a>
        </div>
      </section>
      {selected && <ObjectBrowser base={base} bucket={selected} />}
      <Modal open={dialog} onOpenChange={setDialog} title="Create a bucket">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="attachments" />
        </label>
        <label>
          Visibility
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option>private</option>
            <option>public</option>
          </select>
        </label>
        <label>
          Maximum file size in bytes
          <input type="number" value={size} onChange={(e) => setSize(e.target.value)} />
        </label>
        <label>
          Allowed MIME types (comma separated)
          <input
            value={mime}
            onChange={(e) => setMime(e.target.value)}
            placeholder="image/png, image/jpeg"
          />
        </label>
        <ErrorMessage error={write.error} />
        <Button
          disabled={write.isPending || !name}
          onClick={async () => {
            await write.mutateAsync({
              path: base + '/buckets',
              body: {
                name,
                visibility,
                maxSize: Number(size),
                mimeRules: mime
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            });
            setDialog(false);
          }}
        >
          Create bucket
        </Button>
      </Modal>
    </>
  );
}
function ObjectBrowser({ base, bucket }: { base: string; bucket: string }) {
  const cache = useQueryClient();
  const objects = useQuery({
    queryKey: ['objects', base, bucket],
    queryFn: () => management.request<any[]>(base + '/buckets/' + bucket + '/objects'),
  });
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [remove, setRemove] = useState<any>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Objects</h2>
        <label className="button button-secondary">
          {pending ? 'Uploading…' : 'Upload file'}
          <input
            type="file"
            style={{ display: 'none' }}
            disabled={pending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setPending(true);
              setError('');
              try {
                const intent = await management.request(
                  base + '/buckets/' + bucket + '/objects',
                  'POST',
                  {
                    key: file.name,
                    size: file.size,
                    mime: file.type || 'application/octet-stream',
                  },
                );
                await management.transfer(
                  base + '/objects/' + intent.data.id + '/content',
                  'PUT',
                  file,
                );
                await cache.invalidateQueries({ queryKey: ['objects', base, bucket] });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setPending(false);
              }
            }}
          />
        </label>
      </div>
      <div className="panel-body">
        {error && <Notice kind="error">{error}</Notice>}
        {objects.isPending ? (
          <Loading />
        ) : !objects.data?.data.length ? (
          <Empty title="No objects in this bucket" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Size</th>
                <th>Owner</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {objects.data.data.map((o) => (
                <tr key={o.id}>
                  <td>{o.key}</td>
                  <td>{Number(o.size).toLocaleString()} bytes</td>
                  <td className="mono">{o.owner_id.slice(0, 12)}</td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          const blob = (await management.transfer(
                            base + '/objects/' + o.id + '/content',
                          )) as Blob;
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = o.key.split('/').at(-1);
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Download size={15} />
                    </Button>
                    <Button variant="ghost" onClick={() => setRemove(o)}>
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={!!remove} onOpenChange={(v) => !v && setRemove(null)} title="Delete object">
        <p>Delete {remove?.key} from this branch?</p>
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await management.request(base + '/objects/' + remove.id, 'DELETE');
              setRemove(null);
              await cache.invalidateQueries({ queryKey: ['objects', base, bucket] });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Delete object
        </Button>
      </Modal>
    </section>
  );
}
export function BackupWorkspace({ base, project }: { base: string; project: any }) {
  const backups = useQuery({
    queryKey: ['backups', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/backups`),
  });
  const write = useWrite();
  const [restore, setRestore] = useState(''),
    [cutover, setCutover] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [result, setResult] = useState('');
  const branches = useQuery({
    queryKey: ['branches', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/branches`),
  });
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Encrypted database snapshots</h2>
          <Button
            disabled={write.isPending}
            onClick={() => write.mutate({ path: base + '/backups', body: {} })}
          >
            <Plus size={15} /> Create backup
          </Button>
        </div>
        <div className="panel-body">
          <p className="muted">
            Restore creates a separate branch and excludes active sessions. Object bytes require a
            separate S3 backup.
          </p>
          <ErrorMessage error={write.error} />
          {result && <Notice kind="success">{result}</Notice>}
          {backups.isPending ? (
            <Loading />
          ) : !backups.data?.data.length ? (
            <Empty title="No snapshots yet" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Snapshot</th>
                    <th>Schema</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {backups.data.data.map((b) => (
                    <tr key={b.id}>
                      <td className="mono">{b.id.slice(0, 12)}</td>
                      <td>{b.schema_version}</td>
                      <td>{new Date(b.created_at).toLocaleString()}</td>
                      <td>
                        <Button variant="secondary" onClick={() => setRestore(b.id)}>
                          Restore separately
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className="panel panel-body">
        <h2>Validated restore cutover</h2>
        <p className="muted">
          Validate a restored branch before switching production traffic. Cutover creates a rollback
          checkpoint, fences the old owner and signs application users out.
        </p>
        {(branches.data?.data ?? [])
          .filter((branch) => branch.status === 'ready' && branch.name !== 'main')
          .map((branch) => (
            <div className="policy-row" key={branch.id}>
              <code>{branch.name}</code>
              <Button
                variant="secondary"
                onClick={() => {
                  setCutover(branch.id);
                  setConfirmation('');
                }}
              >
                Make primary
              </Button>
            </div>
          ))}
      </section>
      <Modal
        open={!!cutover}
        onOpenChange={(open) => !open && setCutover('')}
        title="Switch primary branch"
        description="This redirects production database traffic to the selected restored branch."
      >
        <label>
          Type the project slug: {project.slug}
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        <Button
          variant="danger"
          disabled={confirmation !== project.slug || write.isPending}
          onClick={async () => {
            const result = await write.mutateAsync({
              path: `/projects/${project.id}/branches/${cutover}/cutover`,
              body: { confirm: confirmation },
            });
            setResult('Primary switched to ' + result.data.branchId);
            setCutover('');
          }}
        >
          Switch production traffic
        </Button>
        <ErrorMessage error={write.error} />
      </Modal>
      <Modal
        open={!!restore}
        onOpenChange={(v) => !v && setRestore('')}
        title="Restore an isolated branch"
        description="The primary branch is not switched by this operation."
      >
        <p>
          Snapshot: <code>{restore}</code>
        </p>
        <Button
          disabled={write.isPending}
          onClick={async () => {
            const r = await write.mutateAsync({
              path: `/projects/${project.id}/backups/${restore}/restore`,
              body: {},
            });
            setResult('Restored branch ' + r.data.branchId + ' is ready for validation.');
            setRestore('');
          }}
        >
          Restore snapshot
        </Button>
        <ErrorMessage error={write.error} />
      </Modal>
    </>
  );
}
function ProjectQuotas({ project }: { project: any }) {
  const configuration = useQuery({
    queryKey: ['config', project.id],
    queryFn: () => management.request<any>(`/projects/${project.id}/config`),
  });
  const write = useWrite();
  const [limits, setLimits] = useState<Record<string, string>>({
    databaseBytes: '1073741824',
    storageBytes: '1073741824',
    requestsPerMinute: '600',
  });
  useEffect(() => {
    if (configuration.data)
      setLimits(
        Object.fromEntries(
          Object.entries(configuration.data.data.quotas).map(([name, value]) => [
            name,
            String(value),
          ]),
        ),
      );
  }, [configuration.data]);
  if (configuration.isPending) return <Loading />;
  return (
    <section className="panel panel-body">
      <h2>Project quotas</h2>
      <p className="muted">
        Database and reserved storage limits apply to each branch. Rate limits apply to each
        credential. Changing these values closes affected owners so clients may reconnect.
      </p>
      {Object.entries({
        databaseBytes: 'Database bytes per branch',
        storageBytes: 'Reserved object bytes per branch',
        requestsPerMinute: 'Requests per minute per credential',
      }).map(([name, label]) => (
        <label key={name}>
          {label}
          <input
            type="number"
            min="1"
            step="1"
            value={limits[name]}
            onChange={(event) => setLimits({ ...limits, [name]: event.target.value })}
          />
        </label>
      ))}
      <Button
        disabled={write.isPending || !configuration.data}
        onClick={async () => {
          await write.mutateAsync({
            path: `/projects/${project.id}/config`,
            method: 'PUT',
            body: {
              quotas: Object.fromEntries(
                Object.entries(limits).map(([name, value]) => [name, Number(value)]),
              ),
            },
            headers: { 'if-match': String(configuration.data!.data.version) },
          });
        }}
      >
        Save quotas
      </Button>
      <ErrorMessage error={write.error ?? configuration.error} />
    </section>
  );
}
export function SettingsWorkspace({
  project,
  organizationId,
}: {
  project: any;
  organizationId: string;
}) {
  const members = useQuery({
    queryKey: ['members', organizationId],
    queryFn: () => management.request<any[]>(`/organizations/${organizationId}/members`),
  });
  const write = useWrite();
  const [email, setEmail] = useState(''),
    [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState('viewer'),
    [recovery, setRecovery] = useState<string[]>([]),
    [mfaSuccess, setMFASuccess] = useState(false),
    [mfa, setMFA] = useState(''),
    [mfaPassword, setMFAPassword] = useState(''),
    [mfaCode, setMFACode] = useState(''),
    [mfaError, setMFAError] = useState(''),
    [managementToken, setManagementToken] = useState(''),
    [organizationScope, setOrganizationScope] = useState(false),
    [readOnly, setReadOnly] = useState(true),
    [organizationName, setOrganizationName] = useState('');
  const tokens = useQuery({
    queryKey: ['management-tokens'],
    queryFn: () => management.request<any[]>('/tokens'),
  });
  useEffect(() => setManagementToken(''), [project?.id, organizationId]);
  return (
    <div className="stack">
      <section className="panel panel-body">
        <h2>Create an organization</h2>
        <label>
          Organization name
          <input
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
          />
        </label>
        <Button
          disabled={!organizationName || write.isPending}
          onClick={async () => {
            await write.mutateAsync({ path: '/organizations', body: { name: organizationName } });
            setOrganizationName('');
          }}
        >
          Create organization
        </Button>
      </section>
      <section className="panel panel-body">
        <h2>CLI and automation credentials</h2>
        <p className="muted">
          Create a 30-day management token scoped to the selected project. Add organization scope
          only when the automation must create projects.
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          Read-only access
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={organizationScope}
            onChange={(event) => setOrganizationScope(event.target.checked)}
          />
          Include this organization’s project lifecycle
        </label>
        <Button
          disabled={write.isPending || (!project && !organizationScope)}
          onClick={async () => {
            const result = await write.mutateAsync({
              path: '/tokens',
              body: {
                projects: project ? [project.id] : [],
                organizations: organizationScope ? [organizationId] : [],
                readOnly,
              },
            });
            setManagementToken(result.data.token);
          }}
        >
          Create management token
        </Button>
        {managementToken && (
          <Notice>
            Copy this token once into your secure environment store. Set{' '}
            <code>QB_MANAGEMENT_TOKEN</code> when running the CLI.
            <code className="key-value">{managementToken}</code>
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(managementToken)}>
              Copy token
            </Button>
            <Button variant="ghost" onClick={() => setManagementToken('')}>
              Hide token
            </Button>
          </Notice>
        )}
        {tokens.data?.data
          .filter((token) => !token.revoked_at)
          .map((token) => (
            <div className="policy-row" key={token.id}>
              <code>{token.id.slice(0, 12)}</code>
              <small>Expires {new Date(token.expires_at).toLocaleDateString()}</small>
              <Button
                variant="ghost"
                onClick={() => write.mutate({ path: '/tokens/' + token.id, method: 'DELETE' })}
              >
                Revoke
              </Button>
            </div>
          ))}
        <ErrorMessage error={write.error} />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Organization members</h2>
        </div>
        <div className="panel-body">
          {members.data?.data.map((m) => (
            <div className="policy-row" key={m.user_id}>
              <UsersIcon />
              <strong>{m.name}</strong>
              <small>{m.email}</small>
              {m.role === 'owner' ? (
                <Badge>owner</Badge>
              ) : (
                <select
                  aria-label={'Role for ' + m.email}
                  value={m.role}
                  onChange={(event) =>
                    write.mutate({
                      path: `/organizations/${organizationId}/members`,
                      body: { email: m.email, role: event.target.value },
                    })
                  }
                >
                  <option>viewer</option>
                  <option>developer</option>
                  <option>admin</option>
                </select>
              )}
            </div>
          ))}
          <h3 className="settings-heading">Add a platform account</h3>
          <div className="form-columns">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>
          <label>
            Temporary password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
            />
          </label>
          <label>
            Organization role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option>viewer</option>
              <option>developer</option>
              <option>admin</option>
            </select>
          </label>
          <Button
            disabled={write.isPending || password.length < 12}
            onClick={async () => {
              await write.mutateAsync({
                path: '/invitations',
                body: { organizationId, name, email, temporaryPassword: password, role },
              });
              setPassword('');
            }}
          >
            Add member
          </Button>
          <ErrorMessage error={write.error} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Administrator two-factor authentication</h2>
        </div>
        <div className="panel-body">
          <label>
            Current password
            <input
              type="password"
              value={mfaPassword}
              onChange={(e) => setMFAPassword(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const result = await raw('/platform/auth/two-factor/enable', 'POST', {
                  password: mfaPassword,
                });
                setMFA(result.totpURI);
                setRecovery(result.backupCodes ?? []);
                setMFAPassword('');
              } catch (e) {
                setMFAError((e as Error).message);
              }
            }}
          >
            Enable authenticator
          </Button>
          {mfa && (
            <>
              <p>Import this URI into your authenticator, then verify a code.</p>
              <code className="key-value">{mfa}</code>
              <label>
                Authenticator code
                <input value={mfaCode} onChange={(e) => setMFACode(e.target.value)} />
              </label>
              <Button
                onClick={async () => {
                  try {
                    await raw('/platform/auth/two-factor/verify-totp', 'POST', { code: mfaCode });
                    setMFA('');
                    setMFACode('');
                    setMFASuccess(true);
                  } catch (e) {
                    setMFAError((e as Error).message);
                  }
                }}
              >
                Verify enrollment
              </Button>
            </>
          )}
          {recovery.length > 0 && (
            <Notice>
              Save these recovery codes once in a secure password manager.
              <pre>{recovery.join('\n')}</pre>
            </Notice>
          )}
          {mfaSuccess && <Notice kind="success">Authenticator enrollment verified.</Notice>}
          {mfaError && <Notice kind="error">{mfaError}</Notice>}
        </div>
      </section>
      {project && <ProjectQuotas project={project} />}
      {project && (
        <section className="panel panel-body">
          <h2>Project configuration</h2>
          <dl className="details">
            <dt>Name</dt>
            <dd>{project.name}</dd>
            <dt>Region</dt>
            <dd>{project.region}</dd>
            <dt>Slug</dt>
            <dd>{project.slug}</dd>
          </dl>
          <a href={docsURL + '/docs/self-hosting/deployment'} className="button button-secondary">
            Self-hosting guide
          </a>
        </section>
      )}
    </div>
  );
}
function UsersIcon() {
  return <ShieldCheck size={15} />;
}
