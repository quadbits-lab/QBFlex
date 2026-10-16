import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Plus,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Columns3,
  KeyRound,
  ShieldCheck,
  Play,
  Lock,
  Table2,
  Pencil,
  Trash2,
  Search,
  Globe,
  ArrowUpDown,
  MoreHorizontal,
  RefreshCw,
  X,
  Filter,
} from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FieldGroup,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Field,
  FieldLabel,
  Input,
  Label,
  Loading,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShadcnButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Checkbox,
  FieldSet,
  FieldLegend,
  toast,
  notifyError,
} from '@qb-flex/ui';
import { management } from '../api';
import { ErrorMessage, download, useWrite } from './shared';
import { CreateTableDialog } from './create-table-dialog';
import type { TableSchema } from '@qb-flex/contracts';

export function DatabaseWorkspace({ base }: { base: string }) {
  const schema = useQuery({
    queryKey: ['schema', base],
    queryFn: () =>
      management.request<{ tables: TableSchema[]; schemaVersion: number }>(base + '/schema'),
  });
  const policies = useQuery({
    queryKey: ['policies', base],
    queryFn: () => management.request<any[]>(base + '/policies'),
  });
  const tables = schema.data?.data.tables ?? [];
  const [table, setTable] = useState('');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [tab, setTab] = useState('data');
  const [tableSearch, setTableSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const selected = tables.find((t) => t.name === table);
  const filteredTables = useMemo(() => {
    const needle = tableSearch.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tables, tableSearch]);
  const policyCount =
    policies.data?.data.filter((p: any) => p.resource === table && p.enabled !== false).length ?? 0;

  const openTable = (name: string, nextTab = 'data') => {
    setTable(name);
    setOpenTabs((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setTab(nextTab);
  };
  const closeTab = (name: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((item) => item !== name);
      if (table === name) {
        const fallback = next.at(-1) ?? tables.find((t) => t.name !== name)?.name ?? '';
        setTable(fallback);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!tables.length) {
      setTable('');
      setOpenTabs([]);
      return;
    }
    if (!tables.some((t) => t.name === table)) {
      const first = tables[0]!.name;
      setTable(first);
      setOpenTabs([first]);
      return;
    }
    setOpenTabs((prev) => {
      const alive = prev.filter((name) => tables.some((t) => t.name === name));
      if (!alive.includes(table)) return [...alive, table];
      return alive.length === prev.length ? prev : alive;
    });
  }, [schema.data, table, tables]);

  if (schema.isPending) return <Loading />;
  if (schema.error)
    return (
      <>
        <ErrorMessage error={schema.error} />
        <Empty title="Unable to load schema">Refresh or select another project.</Empty>
      </>
    );

  return (
    <div className="flex min-h-[calc(100svh-12rem)] flex-col overflow-hidden rounded-xl border bg-card sm:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b sm:w-60 sm:border-r sm:border-b-0">
        <div className="flex flex-col gap-3 border-b p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="m-0 text-sm font-semibold tracking-tight">Table Editor</p>
              <p className="m-0 text-2xs text-muted-foreground">
                schema v{schema.data?.data.schemaVersion ?? '—'}
              </p>
            </div>
            <Badge variant="outline">public</Badge>
          </div>
          <ShadcnButton className="w-full justify-start" size="sm" onClick={() => setDialog(true)}>
            <Plus data-icon="inline-start" /> New table
          </ShadcnButton>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search tables"
              className="h-8 pl-8"
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Search tables…"
              value={tableSearch}
            />
          </div>
        </div>
        <div className="min-h-0 max-h-56 flex-1 overflow-y-auto p-2 sm:max-h-none">
          {!filteredTables.length ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No tables match.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {filteredTables.map((t) => (
                <li key={t.name}>
                  <button
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      table === t.name
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                    onClick={() => openTable(t.name)}
                    type="button"
                  >
                    <Table2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.name}</span>
                    {t.exposed ? (
                      <Globe
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <Lock
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-3 text-2xs text-muted-foreground">
          <p className="m-0 flex gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Tables stay private until exposed. Policies control row access.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/20 px-1">
          {openTabs.length ? (
            openTabs.map((name) => (
              <div
                key={name}
                className={cn(
                  'group flex h-10 shrink-0 items-center gap-1 border-b-2 px-2 text-sm transition-colors',
                  table === name
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <button
                  className="flex max-w-40 cursor-pointer items-center gap-1.5 truncate"
                  onClick={() => openTable(name)}
                  type="button"
                >
                  <Table2 className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate font-mono text-xs">{name}</span>
                </button>
                <button
                  aria-label={`Close ${name}`}
                  className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
                  onClick={() => closeTab(name)}
                  type="button"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">Select a table to inspect.</p>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <ShadcnButton
                aria-label="Create table"
                className="ml-1 size-8 shrink-0"
                onClick={() => setDialog(true)}
                size="icon"
                variant="ghost"
              >
                <Plus />
              </ShadcnButton>
            </TooltipTrigger>
            <TooltipContent>New table</TooltipContent>
          </Tooltip>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
            <TabsContent value="data" className="mt-0 outline-none">
              {tab === 'data' &&
                (selected ? (
                  <DataGrid
                    key={selected.name}
                    base={base}
                    onOpenPolicies={() => setTab('policies')}
                    policyCount={policyCount}
                    table={selected}
                  />
                ) : (
                  <Empty title="No tables yet">
                    Create a table or apply a migration to start working with data.
                  </Empty>
                ))}
            </TabsContent>
            <TabsContent value="schema" className="mt-0 outline-none">
              {tab === 'schema' && selected && (
                <SchemaEditor key={selected.name} base={base} table={selected} />
              )}
            </TabsContent>
            <TabsContent value="policies" className="mt-0 outline-none">
              {tab === 'policies' && selected && (
                <PolicyEditor key={selected.name} base={base} table={selected} />
              )}
            </TabsContent>
            <TabsContent value="sql" className="mt-0 outline-none">
              {tab === 'sql' && <SQLEditor base={base} />}
            </TabsContent>
            <TabsContent value="migrations" className="mt-0 outline-none">
              {tab === 'migrations' && <Migrations base={base} />}
            </TabsContent>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/15 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              {selected ? (
                <>
                  <span className="font-mono text-foreground">{selected.name}</span>
                  {' · '}
                  {selected.columns.length} columns
                  {' · '}
                  {selected.exposed ? 'API exposed' : 'Private'}
                  {policyCount ? ` · ${policyCount} policies` : ''}
                </>
              ) : (
                'No table selected'
              )}
            </div>
            <TabsList className="h-8">
              {(
                [
                  ['data', 'Data'],
                  ['schema', 'Schema'],
                  ['policies', 'Policies'],
                  ['sql', 'SQL'],
                  ['migrations', 'Migrations'],
                ] as const
              ).map(([value, label]) => (
                <TabsTrigger className="px-2.5 text-xs" key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      </div>
      <CreateTableDialog
        base={base}
        open={dialog}
        onClose={() => setDialog(false)}
        tables={tables}
      />
    </div>
  );
}

const EMPTY_ROWS: any[] = [];

function DataGrid({
  base,
  table,
  policyCount = 0,
  onOpenPolicies,
}: {
  base: string;
  table: TableSchema;
  policyCount?: number;
  onOpenPolicies?: () => void;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [filterColumn, setFilterColumn] = useState(table.columns[0]?.name ?? '');
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [importDialog, setImportDialog] = useState(false);
  const [importText, setImportText] = useState('');
  const [rowDialog, setRowDialog] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [nulls, setNulls] = useState<Record<string, boolean>>({});
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
    setValues(
      row
        ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? '' : String(v)]))
        : {},
    );
    setNulls(row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null])) : {});
    setRowDialog(true);
  };
  const key = (row: any) => {
    const pkValues = table.columns
      .filter((c) => c.primaryKey)
      .sort((a, b) => a.primaryKey - b.primaryKey)
      .map((c) => row[c.name]);
    return pkValues.length === 1
      ? String(pkValues[0])
      : btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(pkValues))))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
  };
  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      ...table.columns.map((c) => ({
        accessorKey: c.name,
        header: () => (
          <button
            className="flex cursor-pointer items-center gap-1.5 text-2xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              setCursor(undefined);
              setSort({
                column: c.name,
                direction: sort?.column === c.name && sort.direction === 'asc' ? 'desc' : 'asc',
              });
            }}
          >
            {c.primaryKey ? <KeyRound className="size-3.5" aria-hidden="true" /> : null}
            {c.name}
            <span className="font-mono text-[0.625rem] lowercase tracking-normal">
              {c.type.toLowerCase()}
            </span>
            {sort?.column === c.name && <span>{sort.direction === 'asc' ? '↑' : '↓'}</span>}
          </button>
        ),
        cell: ({ getValue }: any) =>
          getValue() === null ? (
            <span className="font-mono text-2xs italic text-muted-foreground">null</span>
          ) : (
            <span>{String(getValue())}</span>
          ),
      })),
      {
        id: 'actions',
        header: '',
        cell: ({ row }: any) => (
          <div className="flex justify-end gap-1">
            <ShadcnButton
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Edit row"
              onClick={() => openRow(row.original)}
            >
              <Pencil />
            </ShadcnButton>
            <ShadcnButton
              variant="ghost"
              size="icon"
              className="size-7 text-destructive-foreground hover:text-destructive"
              aria-label="Delete row"
              onClick={() => openRow({ ...row.original, __delete: true })}
            >
              <Trash2 />
            </ShadcnButton>
          </div>
        ),
      },
    ],
    [table.columns, sort],
  );
  const grid = useReactTable({
    data: rows.data?.data ?? EMPTY_ROWS,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
  });
  const gridRows = grid.getRowModel().rows;
  const virtual = useVirtualizer({
    count: gridRows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 41,
    overscan: 8,
  });
  const items = virtual.getVirtualItems();
  const save = async () => {
    try {
      if (edit?.__delete) {
        await write.mutateAsync({
          path: base + '/data/' + table.name + '/' + encodeURIComponent(key(edit)),
          method: 'DELETE',
        });
        toast.success('Row deleted');
      } else {
        const row: any = {};
        for (const c of table.columns) {
          if (c.generated || (edit && c.primaryKey) || (c.name === 'revision' && edit)) continue;
          if (!(c.name in values) && !nulls[c.name]) continue;
          row[c.name] = nulls[c.name]
            ? null
            : /^boolean$/i.test(c.type) && /^(?:0|1|true|false)$/i.test(values[c.name] ?? '')
              ? /^(?:1|true)$/i.test(values[c.name]!)
                ? 1
                : 0
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
        toast.success(edit ? 'Row updated' : 'Row inserted');
      }
      setRowDialog(false);
    } catch {}
  };
  return (
    <>
      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent>
          <DialogTitle>Import rows</DialogTitle>
          <DialogDescription>
            Insert a maximum of 100 rows atomically using your organization permissions.
          </DialogDescription>
          <Field>
            <FieldLabel htmlFor="import-json">JSON row array</FieldLabel>
            <Textarea
              id="import-json"
              className="min-h-40 font-mono text-xs"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="import-file">Choose a JSON file</FieldLabel>
            <Input
              id="import-file"
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                try {
                  const file = event.target.files?.[0];
                  if (file) {
                    if (file.size > 65536) throw new Error('Choose a file under 64 KiB');
                    setImportText(await file.text());
                  }
                } catch (fileError) {
                  notifyError(fileError, 'Unable to read import file');
                }
              }}
            />
          </Field>
          <CardFooter className="px-0">
            <Button
              disabled={write.isPending || !importText}
              onClick={async () => {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(importText);
                  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100)
                    throw new Error('Provide 1–100 rows');
                } catch (importError) {
                  notifyError(importError, 'Invalid import payload');
                  return;
                }
                try {
                  await write.mutateAsync({
                    path: base + '/data/' + table.name,
                    body: parsed,
                    headers: { 'idempotency-key': crypto.randomUUID() },
                  });
                  toast.success(`${(parsed as unknown[]).length} rows imported`);
                  setImportDialog(false);
                } catch {}
              }}
            >
              {write.isPending && <Spinner data-icon="inline-start" />}
              Import rows
            </Button>
          </CardFooter>
        </DialogContent>
      </Dialog>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Filter
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Filter rows"
              className="pl-8"
              placeholder="Filter rows…"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setCursor(undefined);
              }}
            />
          </div>
          <Select
            value={filterColumn}
            onValueChange={(v) => {
              setFilterColumn(v);
              setCursor(undefined);
            }}
          >
            <SelectTrigger className="w-36" aria-label="Filter column">
              <SelectValue placeholder="Column" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {table.columns.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton variant="outline" size="sm">
                <ArrowUpDown data-icon="inline-start" />
                Sort
                {sort ? (
                  <Badge className="ml-1" variant="secondary">
                    {sort.column}
                  </Badge>
                ) : null}
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-48 overflow-y-auto">
              {table.columns.map((c) => (
                <DropdownMenuItem
                  key={c.name}
                  onSelect={() => {
                    setCursor(undefined);
                    setSort({
                      column: c.name,
                      direction:
                        sort?.column === c.name && sort.direction === 'asc' ? 'desc' : 'asc',
                    });
                  }}
                >
                  {c.name}
                  {sort?.column === c.name ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                </DropdownMenuItem>
              ))}
              {sort ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      setSort(null);
                      setCursor(undefined);
                    }}
                  >
                    Clear sort
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <ShadcnButton size="sm" variant="outline" onClick={onOpenPolicies}>
            <ShieldCheck data-icon="inline-start" />
            {policyCount} {policyCount === 1 ? 'policy' : 'policies'}
          </ShadcnButton>
          <Badge variant={table.exposed ? 'success' : 'outline'}>
            {table.exposed ? 'Exposed' : 'Private'}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton variant="ghost" size="sm">
                <Columns3 data-icon="inline-start" /> Columns
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-44 overflow-y-auto">
              {grid
                .getAllLeafColumns()
                .filter((c) => c.id !== 'actions')
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(checked) => c.toggleVisibility(checked === true)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton aria-label="More actions" size="icon" variant="ghost">
                <MoreHorizontal />
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  download(
                    JSON.stringify(rows.data?.data ?? [], null, 2),
                    table.name + '.json',
                    'application/json',
                  )
                }
              >
                <DownloadIcon /> Export page
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setImportDialog(true);
                  setImportText('');
                }}
              >
                <UploadIcon /> Import JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void rows.refetch()}>
                <RefreshCw /> Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ShadcnButton size="sm" onClick={() => openRow()}>
            <Plus data-icon="inline-start" /> Insert
          </ShadcnButton>
        </div>
        <ErrorMessage error={rows.error} />
        {rows.isPending ? (
          <Loading />
        ) : !gridRows.length ? (
          <Empty title="No matching rows">Insert a row or change the filter.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <div
              className="h-[min(520px,calc(100svh-26rem))] overflow-auto [&_td]:max-w-[280px] [&_td]:truncate"
              ref={parent}
            >
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                  {grid.getHeaderGroups().map((group) => (
                    <tr key={group.id} className="border-b border-border">
                      {group.headers.map((header) => (
                        <th key={header.id} className="px-3 py-2.5 font-medium">
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
                      <tr
                        key={row.id}
                        className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-3 py-2 align-middle font-mono text-xs">
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
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {rows.data?.data.length ?? 0} rows on this page
            {rows.data?.meta.count != null ? ` · ${rows.data.meta.count} total` : ''}
          </span>
          <div className="flex gap-2">
            <ShadcnButton
              variant="ghost"
              size="sm"
              disabled={!cursor}
              onClick={() => setCursor(undefined)}
            >
              First page
            </ShadcnButton>
            <ShadcnButton
              variant="outline"
              size="sm"
              disabled={!rows.data?.meta.cursor}
              onClick={() => setCursor(rows.data?.meta.cursor)}
            >
              Next page
            </ShadcnButton>
          </div>
        </div>
      </div>
      <Dialog open={rowDialog} onOpenChange={setRowDialog}>
        <DialogContent>
          <DialogTitle>
            {edit?.__delete ? 'Delete row' : edit ? 'Edit row' : 'Insert row'}
          </DialogTitle>
          <DialogDescription>
            {edit?.__delete
              ? 'This removes the selected row from the current branch.'
              : 'Values are validated by PostgreSQL and the Management API.'}
          </DialogDescription>
          {edit?.__delete ? (
            <p className="truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">{key(edit)}</p>
          ) : (
            <FieldGroup>
              {table.columns
                .filter(
                  (c) =>
                    !c.generated && !(edit && c.primaryKey) && !(edit && c.name === 'revision'),
                )
                .map((c) => (
                  <Field key={c.name}>
                    <FieldLabel htmlFor={'row-' + c.name}>
                      {c.name}
                      <span className="font-mono text-2xs font-normal text-muted-foreground">
                        {c.type}
                        {c.default !== null ? ` · default ${c.default}` : ''}
                      </span>
                    </FieldLabel>
                    <Input
                      id={'row-' + c.name}
                      placeholder={
                        /^boolean$/i.test(c.type) ? 'true / false (or 1 / 0)' : undefined
                      }
                      value={values[c.name] ?? ''}
                      disabled={nulls[c.name]}
                      onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
                    />
                    {c.nullable && (
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Switch
                          checked={!!nulls[c.name]}
                          onCheckedChange={(checked) =>
                            setNulls((v) => ({ ...v, [c.name]: checked }))
                          }
                          aria-label={'Set ' + c.name + ' to null'}
                        />
                        Set null
                      </label>
                    )}
                  </Field>
                ))}
            </FieldGroup>
          )}
          <CardFooter className="px-0">
            <Button
              variant={edit?.__delete ? 'danger' : 'primary'}
              disabled={write.isPending}
              onClick={save}
            >
              {write.isPending && <Spinner data-icon="inline-start" />}
              {edit?.__delete ? 'Delete row' : 'Save row'}
            </Button>
          </CardFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SchemaEditor({ base, table }: { base: string; table: TableSchema }) {
  const write = useWrite();
  const [exposure, setExposure] = useState(table.exposed);
  const [columns, setColumns] = useState(table.allowedColumns);
  const [sql, setSql] = useState('');
  useEffect(() => {
    setExposure(table.exposed);
    setColumns(table.allowedColumns);
  }, [table.name, table.exposed, table.allowedColumns]);
  return (
    <div className="grid grid-cols-1 content-start gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Columns</CardTitle>
          <CardDescription>
            {table.columns.length} columns in {table.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Nullable</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Key</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.columns.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="font-mono">{c.name}</TableCell>
                  <TableCell className="font-mono">{c.type}</TableCell>
                  <TableCell>{c.nullable ? 'Yes' : 'No'}</TableCell>
                  <TableCell className="font-mono">{c.default ?? '—'}</TableCell>
                  <TableCell>
                    {c.primaryKey ? (
                      <Badge variant="outline">Primary</Badge>
                    ) : c.generated ? (
                      <Badge variant="outline">Generated</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>API exposure</CardTitle>
          <Badge variant={table.exposed ? 'success' : 'default'}>
            {table.exposed ? 'Exposed' : 'Private'}
          </Badge>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <Switch
              checked={exposure}
              onCheckedChange={setExposure}
              aria-label="Enable public API routes"
            />
            <span>
              Enable public API routes
              <span className="block text-2xs text-muted-foreground">
                Policies must grant access separately. Primary keys are required in the public
                projection.
              </span>
            </span>
          </label>
          <FieldSet>
            <FieldLegend variant="label">Allowed columns</FieldLegend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {table.columns.map((c) => (
                <label className="flex cursor-pointer items-center gap-2 text-sm" key={c.name}>
                  <Checkbox
                    checked={columns.includes(c.name)}
                    disabled={!!c.primaryKey}
                    onCheckedChange={(checked) =>
                      setColumns((v) =>
                        checked === true ? [...v, c.name] : v.filter((n) => n !== c.name),
                      )
                    }
                  />
                  <span className="font-mono text-xs">{c.name}</span>
                  {!!c.primaryKey && <Badge>required</Badge>}
                </label>
              ))}
            </div>
          </FieldSet>
        </CardContent>
        <CardFooter>
          <Button
            disabled={write.isPending}
            onClick={async () => {
              try {
                await write.mutateAsync({
                  path: base + '/exposure/' + table.name,
                  method: 'PUT',
                  body: { enabled: exposure, columns },
                });
                toast.success('Exposure saved for ' + table.name);
              } catch {}
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Save exposure
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Indexes and relationships</CardTitle>
          <CardDescription>Physical indexes and foreign keys on {table.name}.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed">
            {JSON.stringify({ indexes: table.indexes, foreignKeys: table.foreignKeys }, null, 2)}
          </pre>
          <Field>
            <FieldLabel htmlFor="index-sql">
              Schema migration for an index or relationship
            </FieldLabel>
            <Textarea
              id="index-sql"
              className="min-h-28 font-mono text-xs"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            disabled={!sql || write.isPending}
            onClick={async () => {
              try {
                await write.mutateAsync({
                  path: base + '/migrations',
                  body: { id: 'schema_' + Date.now(), sql },
                });
                toast.success('Migration applied');
                setSql('');
              } catch {}
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Apply migration
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

const ownership = { op: 'eq', left: { column: 'owner_id' }, right: { claim: 'sub' } };
function PolicyEditor({ base, table }: { base: string; table: TableSchema }) {
  const [operation, setOperation] = useState('select');
  const [expression, setExpression] = useState(JSON.stringify(ownership, null, 2));
  const [role, setRole] = useState('authenticated');
  const [mode, setMode] = useState('permissive');
  const [subject, setSubject] = useState('');
  const [testRole, setTestRole] = useState('authenticated');
  const [result, setResult] = useState('');
  const write = useWrite();
  const saved = useQuery({
    queryKey: ['policies', base],
    queryFn: () => management.request<any[]>(base + '/policies'),
  });
  const appRoles = useQuery({
    queryKey: ['roles', base],
    queryFn: () => management.request<{ name: string }[]>(base + '/roles'),
  });
  const roleOptions = [
    'authenticated',
    'anonymous',
    'service',
    ...(appRoles.data?.data.map((r) => r.name) ?? []),
  ];
  const tablePolicies = saved.data?.data.filter((p: any) => p.resource === table.name) ?? [];
  return (
    <div className="grid grid-cols-1 content-start gap-4">
      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>Default deny</AlertTitle>
        <AlertDescription>
          Without an applicable permissive grant, every public operation is denied.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Policies for {table.name}</CardTitle>
          <CardDescription>{tablePolicies.length} policies on this table</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          {tablePolicies.map((p: any) => (
            <div
              className="flex items-center gap-3 border-b border-border py-2.5 last:border-0"
              key={p.id}
            >
              <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <strong className="font-mono text-xs">{p.operation}</strong>
              <span className="text-muted-foreground">
                {p.roles.join(', ')} · {p.mode}
              </span>
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={async () => {
                  await write.mutateAsync({
                    path: base + '/policies',
                    method: 'PUT',
                    body: { ...p, enabled: !p.enabled },
                  });
                  toast.success(p.enabled ? 'Policy disabled' : 'Policy enabled');
                }}
              >
                {p.enabled ? 'Disable' : 'Enable'}
              </Button>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="policy-operation">Operation</FieldLabel>
              <Select value={operation} onValueChange={setOperation}>
                <SelectTrigger id="policy-operation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {['select', 'insert', 'update', 'delete'].map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="policy-role">Role</FieldLabel>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="policy-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roleOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="policy-mode">Mode</FieldLabel>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger id="policy-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="permissive">permissive</SelectItem>
                    <SelectItem value="restrictive">restrictive</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="policy-expression">USING and WITH CHECK expression</FieldLabel>
            <Textarea
              id="policy-expression"
              className="min-h-32 font-mono text-xs"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </CardContent>
        <CardFooter>
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
                toast.success('Policy created');
              } catch {}
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Create policy
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Test an application identity</CardTitle>
          <CardDescription>
            Evaluate the select policy against a real or fixture subject.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="policy-subject">Application user ID</FieldLabel>
              <Input
                id="policy-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Use a real user ID or fixture subject"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="policy-test-role">Simulated role</FieldLabel>
              <Select value={testRole} onValueChange={setTestRole}>
                <SelectTrigger id="policy-test-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roleOptions
                      .filter((r) => r !== 'service')
                      .map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div>
            <ShadcnButton
              variant="outline"
              onClick={async () => {
                try {
                  const anonymous = !subject || testRole === 'anonymous';
                  const outcome = await management.request(base + '/policies/test', 'POST', {
                    table: table.name,
                    identity: {
                      sub: anonymous ? null : subject,
                      role: anonymous ? 'anonymous' : 'authenticated',
                      roles:
                        anonymous || testRole === 'authenticated' || testRole === 'anonymous'
                          ? []
                          : [testRole],
                    },
                    query: { limit: 10, count: true },
                  });
                  setResult(JSON.stringify(outcome, null, 2));
                } catch (testError) {
                  notifyError(testError, 'Policy test failed');
                }
              }}
            >
              <Play data-icon="inline-start" /> Evaluate select
            </ShadcnButton>
          </div>
          {result && (
            <pre className="max-h-60 overflow-auto rounded-lg border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed">
              {result}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SQLEditor({ base }: { base: string }) {
  const [sql, setSql] = useState('SELECT 1 AS healthy;');
  const [result, setResult] = useState('');
  const write = useWrite();
  return (
    <div className="grid grid-cols-1 content-start gap-4">
      <Alert>
        <AlertTitle>Developer privileges</AlertTitle>
        <AlertDescription>
          SQL runs with developer privileges in the selected branch. Writes create a recovery
          snapshot first.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>SQL console</CardTitle>
          <CardDescription>Direct branch access for diagnosis and bulk data work.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <Field>
            <FieldLabel htmlFor="sql-editor" className="sr-only">
              PostgreSQL SQL
            </FieldLabel>
            <Textarea
              id="sql-editor"
              className="min-h-36 font-mono text-xs"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </CardContent>
        <CardFooter className="items-center gap-3">
          <Button
            disabled={write.isPending}
            onClick={async () => {
              const r = await write.mutateAsync({ path: base + '/sql', body: { sql } });
              setResult(JSON.stringify(r.data, null, 2));
              toast.success('SQL executed');
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            <Play data-icon="inline-start" />
            Run SQL
          </Button>
        </CardFooter>
      </Card>
      {result && (
        <pre className="overflow-auto rounded-lg border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed">
          {result}
        </pre>
      )}
    </div>
  );
}

function Migrations({ base }: { base: string }) {
  const list = useQuery({
    queryKey: ['migrations', base],
    queryFn: () => management.request<any[]>(base + '/migrations'),
  });
  const [id, setId] = useState('');
  const [sql, setSql] = useState('');
  const write = useWrite();
  return (
    <div className="grid grid-cols-1 content-start gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Migration history</CardTitle>
          <CardDescription>Applied migrations on this branch, newest last.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Loading />
          ) : !list.data?.data.length ? (
            <Empty title="No migrations yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Checksum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data?.data.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono">{m.id}</TableCell>
                    <TableCell>{new Date(m.applied_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {m.checksum.slice(0, 16)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Apply a migration</CardTitle>
          <CardDescription>
            Migrations run in transactions with foreign-key validation and a schema stamp.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <Field>
            <FieldLabel htmlFor="migration-new-id">Migration ID</FieldLabel>
            <Input
              id="migration-new-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="002_add_index"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="migration-new-sql">SQL migration</FieldLabel>
            <Textarea
              id="migration-new-sql"
              className="min-h-32 font-mono text-xs"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            disabled={!id || !sql || write.isPending}
            onClick={async () => {
              await write.mutateAsync({ path: base + '/migrations', body: { id, sql } });
              toast.success('Migration ' + id + ' applied');
              setId('');
              setSql('');
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Apply migration
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
