/** Pure helpers for Studio create-table SQL generation and validation. */

export type PostgresTypePreset =
  'TEXT' | 'BIGINT' | 'DOUBLE PRECISION' | 'BYTEA' | 'BOOLEAN' | 'TIMESTAMPTZ';

export type ColumnDraft = {
  id: string;
  name: string;
  type: PostgresTypePreset;
  defaultValue: string;
  nullable: boolean;
  primary: boolean;
};

export type ForeignKeyDraft = {
  id: string;
  localColumn: string;
  referencedTable: string;
  referencedColumn: string;
};

export type CreateTableDefinition = {
  name: string;
  description: string;
  columns: ColumnDraft[];
  foreignKeys: ForeignKeyDraft[];
};

export const POSTGRES_TYPE_PRESETS: ReadonlyArray<{
  value: PostgresTypePreset;
  label: string;
  sqlType: string;
  check?: string;
}> = [
  { value: 'TEXT', label: 'TEXT', sqlType: 'TEXT' },
  { value: 'BIGINT', label: 'BIGINT', sqlType: 'BIGINT' },
  { value: 'DOUBLE PRECISION', label: 'DOUBLE PRECISION', sqlType: 'DOUBLE PRECISION' },
  { value: 'BYTEA', label: 'BYTEA', sqlType: 'BYTEA' },
  {
    value: 'BOOLEAN',
    label: 'BOOLEAN',
    sqlType: 'BOOLEAN',
  },
  { value: 'TIMESTAMPTZ', label: 'TIMESTAMPTZ', sqlType: 'TIMESTAMPTZ' },
];

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeIdent(name: string): boolean {
  return SAFE_IDENT.test(name);
}

export function quoteIdent(name: string): string {
  if (isSafeIdent(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

export function newDraftId(): string {
  return crypto.randomUUID();
}

export function defaultColumns(): ColumnDraft[] {
  return [
    {
      id: newDraftId(),
      name: 'id',
      type: 'TEXT',
      defaultValue: '(gen_random_uuid()::text)',
      nullable: false,
      primary: true,
    },
    {
      id: newDraftId(),
      name: 'created_at',
      type: 'TIMESTAMPTZ',
      defaultValue: '(CURRENT_TIMESTAMP)',
      nullable: false,
      primary: false,
    },
  ];
}

export function emptyColumn(): ColumnDraft {
  return {
    id: newDraftId(),
    name: '',
    type: 'TEXT',
    defaultValue: 'NULL',
    nullable: true,
    primary: false,
  };
}

export function emptyForeignKey(): ForeignKeyDraft {
  return {
    id: newDraftId(),
    localColumn: '',
    referencedTable: '',
    referencedColumn: 'id',
  };
}

export function resolveType(preset: PostgresTypePreset) {
  const found = POSTGRES_TYPE_PRESETS.find((p) => p.value === preset);
  return found ?? POSTGRES_TYPE_PRESETS[0]!;
}

/** Normalize a default expression for DDL. Empty → omit DEFAULT. */
export function formatDefault(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.toUpperCase() === 'NULL') return null;
  // Numeric / quoted / blob literals can stand alone.
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return value;
  if (/^'([^']|'')*'$/.test(value)) return value;
  if (/^X'[0-9A-Fa-f]*'$/i.test(value)) return value;
  // PostgreSQL requires parentheses around expression defaults.
  if (value.startsWith('(') && value.endsWith(')')) return value;
  return `(${value})`;
}

export function validateCreateTableDefinition(
  def: CreateTableDefinition,
  existingTables: ReadonlyArray<{ name: string; columns: ReadonlyArray<{ name: string }> }>,
): string[] {
  const errors: string[] = [];
  const tableName = def.name.trim();
  if (!tableName) errors.push('Table name is required.');
  else if (!isSafeIdent(tableName)) {
    errors.push(
      'Table name must start with a letter or underscore and use only letters, digits, or underscores.',
    );
  } else if (existingTables.some((t) => t.name === tableName)) {
    errors.push(`Table "${tableName}" already exists.`);
  }

  if (def.columns.length < 1) errors.push('Add at least one column.');

  const names = def.columns.map((c) => c.name.trim().toLowerCase());
  const seen = new Set<string>();
  for (const col of def.columns) {
    const name = col.name.trim();
    if (!name) {
      errors.push('Every column needs a name.');
      continue;
    }
    if (!isSafeIdent(name)) {
      errors.push(`Column "${name}" is not a valid identifier.`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) errors.push(`Duplicate column name "${name}".`);
    seen.add(key);
  }

  const primaryCount = def.columns.filter((c) => c.primary).length;
  if (primaryCount < 1) errors.push('Select at least one primary key column.');

  const columnNames = new Set(def.columns.map((c) => c.name.trim()).filter(Boolean));
  for (const fk of def.foreignKeys) {
    if (!fk.localColumn.trim() || !fk.referencedTable.trim() || !fk.referencedColumn.trim()) {
      errors.push('Complete every foreign key relation or remove it.');
      continue;
    }
    if (!columnNames.has(fk.localColumn.trim())) {
      errors.push(`Foreign key column "${fk.localColumn}" is not defined on this table.`);
    }
    const target = existingTables.find((t) => t.name === fk.referencedTable.trim());
    if (!target) {
      errors.push(`Referenced table "${fk.referencedTable}" was not found.`);
      continue;
    }
    if (!target.columns.some((c) => c.name === fk.referencedColumn.trim())) {
      errors.push(
        `Referenced column "${fk.referencedColumn}" was not found on "${fk.referencedTable}".`,
      );
    }
  }

  // Collapse repeated "every column needs a name" into one if many empty
  const emptyNameErrors = errors.filter((e) => e === 'Every column needs a name.');
  if (emptyNameErrors.length > 1) {
    return [
      ...errors.filter((e) => e !== 'Every column needs a name.'),
      'Every column needs a name.',
    ];
  }

  void names;
  return errors;
}

function columnLine(col: ColumnDraft): string {
  const preset = resolveType(col.type);
  const parts = [quoteIdent(col.name.trim()), preset.sqlType];
  if (!col.nullable || col.primary) parts.push('NOT NULL');
  const rawDefault =
    col.type === 'BOOLEAN' && /^[01]$/.test(col.defaultValue.trim())
      ? col.defaultValue.trim() === '1'
        ? 'true'
        : 'false'
      : col.defaultValue;
  const def = formatDefault(rawDefault);
  if (def) parts.push(`DEFAULT ${def}`);
  if (preset.check) {
    parts.push(`CHECK (${quoteIdent(col.name.trim())} ${preset.check})`);
  }
  return `  ${parts.join(' ')}`;
}

export function buildCreateTableSQL(def: CreateTableDefinition): string {
  const tableName = quoteIdent(def.name.trim());
  const lines: string[] = [];
  const description = def.description.trim();
  if (description) {
    const safe = description.replaceAll('\n', ' ').replaceAll('--', '—');
    lines.push(`-- ${safe}`);
  }

  const body: string[] = def.columns.map(columnLine);

  const pkCols = def.columns.filter((c) => c.primary).map((c) => quoteIdent(c.name.trim()));
  if (pkCols.length > 0) {
    body.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
  }

  for (const fk of def.foreignKeys) {
    const local = quoteIdent(fk.localColumn.trim());
    const refTable = quoteIdent(fk.referencedTable.trim());
    const refCol = quoteIdent(fk.referencedColumn.trim());
    body.push(`  FOREIGN KEY (${local}) REFERENCES ${refTable}(${refCol})`);
  }

  lines.push(`CREATE TABLE ${tableName} (`);
  lines.push(body.join(',\n'));
  lines.push(');');
  return lines.join('\n');
}

export const DEFAULT_TASK_SQL = `CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (gen_random_uuid()::text),
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  completed BIGINT NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  revision BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX tasks_owner_idx ON tasks(owner_id);`;
