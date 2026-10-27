import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Code2,
  GripVertical,
  Info,
  Plus,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import type { TableSchema } from '@qb-flex/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  ShadcnButton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  toast,
} from '@qb-flex/ui';
import { applyReviewedMigration, useWrite } from './shared';
import {
  DEFAULT_TASK_SQL,
  buildCreateTableSQL,
  defaultColumns,
  emptyColumn,
  emptyForeignKey,
  POSTGRES_TYPE_PRESETS,
  validateCreateTableDefinition,
  type ColumnDraft,
  type ForeignKeyDraft,
  type PostgresTypePreset,
} from './create-table-sql';

type CreateMode = 'gui' | 'sql';

export function CreateTableDialog({
  base,
  open,
  onClose,
  tables,
}: {
  base: string;
  open: boolean;
  onClose: () => void;
  tables: TableSchema[];
}) {
  const [mode, setMode] = useState<CreateMode>('gui');
  const [sqlName, setSqlName] = useState('tasks');
  const [sql, setSql] = useState(DEFAULT_TASK_SQL);
  const [name, setName] = useState('tasks');
  const [description, setDescription] = useState('');
  const [recommendPolicies, setRecommendPolicies] = useState(true);
  const [expose, setExpose] = useState(true);
  const [columns, setColumns] = useState<ColumnDraft[]>(() => defaultColumns());
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const write = useWrite();

  const reset = useCallback(() => {
    setMode('gui');
    setSqlName('tasks');
    setSql(DEFAULT_TASK_SQL);
    setName('tasks');
    setDescription('');
    setRecommendPolicies(true);
    setExpose(true);
    setColumns(defaultColumns());
    setForeignKeys([]);
    setFormError(null);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const primaryOrdinal = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const col of columns) {
      if (col.primary) {
        n += 1;
        map.set(col.id, n);
      }
    }
    return map;
  }, [columns]);

  const updateColumn = (id: string, patch: Partial<ColumnDraft>) => {
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const moveColumn = (id: string, dir: -1 | 1) => {
    setColumns((prev) => {
      const index = prev.findIndex((c) => c.id === id);
      if (index < 0) return prev;
      const next = index + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [row] = copy.splice(index, 1);
      copy.splice(next, 0, row!);
      return copy;
    });
  };

  const saveSql = useCallback(async () => {
    const migrationName = sqlName.trim() || 'table';
    if (!sql.trim()) {
      setFormError('SQL schema is required.');
      return;
    }
    setFormError(null);
    await applyReviewedMigration(base, migrationName + '_' + Date.now(), sql);
    toast.success(`Migration applied for "${migrationName}"`);
    onClose();
  }, [base, onClose, sql, sqlName]);

  const saveGui = useCallback(async () => {
    const definition = { name, description, columns, foreignKeys };
    const errors = validateCreateTableDefinition(definition, tables);
    if (errors.length > 0) {
      setFormError(errors[0]!);
      return;
    }
    setFormError(null);
    const tableName = name.trim();
    const generated = buildCreateTableSQL(definition);
    await applyReviewedMigration(base, tableName + '_' + Date.now(), generated);
    if (expose) {
      await write.mutateAsync({
        path: base + '/exposure/' + tableName,
        method: 'PUT',
        body: {
          enabled: true,
          columns: columns.map((c) => c.name.trim()).filter(Boolean),
        },
      });
    }
    const policyHint = recommendPolicies
      ? ' Add policies on the Policies tab before querying exposed data.'
      : '';
    toast.success(
      expose
        ? `Table "${tableName}" created and exposed.${policyHint}`
        : `Table "${tableName}" created (private).${policyHint}`,
    );
    onClose();
  }, [
    base,
    columns,
    description,
    expose,
    foreignKeys,
    name,
    onClose,
    recommendPolicies,
    tables,
    write,
  ]);

  const onSave = useCallback(async () => {
    try {
      if (mode === 'sql') await saveSql();
      else await saveGui();
    } catch {
      // Errors are surfaced by the management client / toaster.
    }
  }, [mode, saveGui, saveSql]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (!write.isPending) void onSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onSave, write.isPending]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-4xl gap-0 p-0" showClose>
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-lg">Create a new table</DialogTitle>
          <DialogDescription className="mt-1">
            Choose a SQL migration or build the schema with the form wizard.
          </DialogDescription>
          <Tabs
            className="mt-4"
            value={mode}
            onValueChange={(v) => {
              setMode(v as CreateMode);
              setFormError(null);
            }}
          >
            <TabsList>
              <TabsTrigger value="gui">
                <Table2 data-icon="inline-start" className="size-3.5" />
                GUI Form
              </TabsTrigger>
              <TabsTrigger value="sql">
                <Code2 data-icon="inline-start" className="size-3.5" />
                SQL Schema
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="max-h-[min(70vh,720px)] overflow-y-auto px-6 py-5">
          {mode === 'sql' ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="create-table-sql-name">Migration ID</FieldLabel>
                <Input
                  id="create-table-sql-name"
                  value={sqlName}
                  onChange={(e) => setSqlName(e.target.value)}
                  required
                />
                <FieldDescription>
                  Used as the migration id prefix. The table starts private until you expose it.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="create-table-sql-body">PostgreSQL schema</FieldLabel>
                <Textarea
                  id="create-table-sql-body"
                  className="min-h-56 font-mono text-xs"
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </FieldGroup>
          ) : (
            <div className="grid gap-6">
              <section className="grid gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="create-table-name">Name</FieldLabel>
                    <Input
                      id="create-table-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="table_name"
                      required
                      autoFocus
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="create-table-description">Description</FieldLabel>
                    <Input
                      id="create-table-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </FieldGroup>

                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={recommendPolicies}
                    onCheckedChange={(v) => setRecommendPolicies(v === true)}
                    aria-label="Recommend policies"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      Recommend policies
                      <Badge variant="success">RECOMMENDED</Badge>
                    </span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Restrict access by writing ownership policies after the table is created.
                    </span>
                  </span>
                </label>

                {recommendPolicies && (
                  <Alert className="pl-10">
                    <Info aria-hidden="true" />
                    <AlertTitle>Policies are required to query exposed data</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                      After saving, open the Policies tab to grant select/insert/update/delete.
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <BookOpen className="size-3.5" aria-hidden />
                        Default deny until policies exist
                      </span>
                    </AlertDescription>
                  </Alert>
                )}
              </section>

              <Separator />

              <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Columns</h3>
                  <span className="text-2xs text-muted-foreground">
                    PostgreSQL types: TEXT, BIGINT, DOUBLE PRECISION, BYTEA, BOOLEAN, TIMESTAMPTZ
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <div className="grid min-w-[720px] grid-cols-[28px_minmax(120px,1.2fr)_minmax(110px,0.9fr)_minmax(120px,1fr)_72px_88px_36px] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span />
                    <span>Name</span>
                    <span>Type</span>
                    <span>Default Value</span>
                    <span>Null</span>
                    <span>Primary</span>
                    <span />
                  </div>
                  <ul className="divide-y divide-border">
                    {columns.map((col, index) => (
                      <li
                        key={col.id}
                        className="grid min-w-[720px] grid-cols-[28px_minmax(120px,1.2fr)_minmax(110px,0.9fr)_minmax(120px,1fr)_72px_88px_36px] items-center gap-2 px-3 py-2"
                      >
                        <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
                          <GripVertical className="size-3.5 opacity-50" aria-hidden />
                          <div className="flex flex-col">
                            <button
                              type="button"
                              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                              disabled={index === 0}
                              aria-label="Move column up"
                              onClick={() => moveColumn(col.id, -1)}
                            >
                              <ArrowUp className="size-3" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                              disabled={index === columns.length - 1}
                              aria-label="Move column down"
                              onClick={() => moveColumn(col.id, 1)}
                            >
                              <ArrowDown className="size-3" />
                            </button>
                          </div>
                        </div>
                        <Input
                          aria-label={`Column ${index + 1} name`}
                          className="font-mono text-xs"
                          value={col.name}
                          onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                          placeholder="column"
                        />
                        <Select
                          value={col.type}
                          onValueChange={(v) =>
                            updateColumn(col.id, { type: v as PostgresTypePreset })
                          }
                        >
                          <SelectTrigger aria-label={`Column ${index + 1} type`} className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {POSTGRES_TYPE_PRESETS.map((preset) => (
                              <SelectItem key={preset.value} value={preset.value}>
                                {preset.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          aria-label={`Column ${index + 1} default`}
                          className="font-mono text-xs"
                          value={col.defaultValue}
                          onChange={(e) => updateColumn(col.id, { defaultValue: e.target.value })}
                          placeholder="NULL"
                        />
                        <label className="flex items-center justify-center gap-2 text-xs">
                          <Checkbox
                            checked={col.nullable && !col.primary}
                            disabled={col.primary}
                            onCheckedChange={(v) => updateColumn(col.id, { nullable: v === true })}
                            aria-label={`Column ${index + 1} nullable`}
                          />
                        </label>
                        <label className="flex items-center justify-center gap-1.5 text-xs">
                          <Checkbox
                            checked={col.primary}
                            onCheckedChange={(v) =>
                              updateColumn(col.id, {
                                primary: v === true,
                                nullable: v === true ? false : col.nullable,
                              })
                            }
                            aria-label={`Column ${index + 1} primary key`}
                          />
                          {col.primary && (
                            <Badge variant="outline" className="h-5 min-w-5 justify-center px-1">
                              {primaryOrdinal.get(col.id)}
                            </Badge>
                          )}
                        </label>
                        <ShadcnButton
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Remove column ${col.name || index + 1}`}
                          disabled={columns.length <= 1}
                          onClick={() => setColumns((prev) => prev.filter((c) => c.id !== col.id))}
                        >
                          <X className="size-4" />
                        </ShadcnButton>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground"
                  onClick={() => setColumns((prev) => [...prev, emptyColumn()])}
                >
                  <Plus className="size-4" />
                  Add column
                </button>
              </section>

              <Separator />

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Foreign keys</h3>
                {foreignKeys.length > 0 && (
                  <ul className="grid gap-2">
                    {foreignKeys.map((fk) => {
                      const refTable = tables.find((t) => t.name === fk.referencedTable);
                      return (
                        <li
                          key={fk.id}
                          className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                        >
                          <Field>
                            <FieldLabel>Local column</FieldLabel>
                            <Select
                              value={fk.localColumn || undefined}
                              onValueChange={(v) =>
                                setForeignKeys((prev) =>
                                  prev.map((row) =>
                                    row.id === fk.id ? { ...row, localColumn: v } : row,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Column" />
                              </SelectTrigger>
                              <SelectContent>
                                {columns
                                  .filter((c) => c.name.trim())
                                  .map((c) => (
                                    <SelectItem key={c.id} value={c.name.trim()}>
                                      {c.name.trim()}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field>
                            <FieldLabel>Referenced table</FieldLabel>
                            <Select
                              value={fk.referencedTable || undefined}
                              onValueChange={(v) =>
                                setForeignKeys((prev) =>
                                  prev.map((row) =>
                                    row.id === fk.id
                                      ? {
                                          ...row,
                                          referencedTable: v,
                                          referencedColumn:
                                            tables
                                              .find((t) => t.name === v)
                                              ?.columns.find((c) => c.primaryKey)?.name ??
                                            tables.find((t) => t.name === v)?.columns[0]?.name ??
                                            'id',
                                        }
                                      : row,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Table" />
                              </SelectTrigger>
                              <SelectContent>
                                {tables.map((t) => (
                                  <SelectItem key={t.name} value={t.name}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field>
                            <FieldLabel>Referenced column</FieldLabel>
                            <Select
                              value={fk.referencedColumn || undefined}
                              onValueChange={(v) =>
                                setForeignKeys((prev) =>
                                  prev.map((row) =>
                                    row.id === fk.id ? { ...row, referencedColumn: v } : row,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Column" />
                              </SelectTrigger>
                              <SelectContent>
                                {(refTable?.columns ?? []).map((c) => (
                                  <SelectItem key={c.name} value={c.name}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <div className="flex items-end">
                            <ShadcnButton
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label="Remove foreign key"
                              onClick={() =>
                                setForeignKeys((prev) => prev.filter((row) => row.id !== fk.id))
                              }
                            >
                              <Trash2 className="size-4" />
                            </ShadcnButton>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                  disabled={tables.length === 0}
                  onClick={() => setForeignKeys((prev) => [...prev, emptyForeignKey()])}
                >
                  <Plus className="size-4" />
                  Add foreign key relation
                </button>
                {tables.length === 0 && (
                  <p className="text-2xs text-muted-foreground">
                    Create another table first to reference it with a foreign key.
                  </p>
                )}
              </section>

              <Separator />

              <section>
                <label className="flex cursor-pointer items-start justify-between gap-4 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">Data API access</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Expose this table to the Data API. Realtime follows exposure; policies must
                      still grant access.
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <Label htmlFor="create-table-expose" className="text-xs text-muted-foreground">
                      {expose ? 'On' : 'Off'}
                    </Label>
                    <Switch
                      id="create-table-expose"
                      checked={expose}
                      onCheckedChange={setExpose}
                      aria-label="Expose to Data API"
                    />
                  </div>
                </label>
              </section>
            </div>
          )}

          {formError && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Cannot save</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
          <ShadcnButton
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={write.isPending}
          >
            Cancel
          </ShadcnButton>
          <Button
            type="button"
            disabled={write.isPending}
            onClick={() => void onSave()}
            className={cn('gap-2')}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Save
            <kbd className="hidden rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 font-mono text-2xs font-normal sm:inline">
              ⌘↵
            </kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
