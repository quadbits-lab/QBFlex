import type { Database } from 'bun:sqlite';
import {
  QBError,
  type TableSchema,
  type Policy,
  type Relationship,
  type RPCOperation,
} from '@qb-flex/contracts';
import { identifier, compileExpression } from '@qb-flex/policies';
export function initializeBranch(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS _qb_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO _qb_meta VALUES('schema_version','1');
    CREATE TABLE IF NOT EXISTS _qb_migrations(id TEXT PRIMARY KEY,checksum TEXT NOT NULL,author TEXT NOT NULL,sql TEXT NOT NULL,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _qb_schema_exposure(table_name TEXT PRIMARY KEY,enabled INTEGER NOT NULL,allowed_columns TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _qb_relationships(name TEXT NOT NULL,source TEXT NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(name,source));
    CREATE TABLE IF NOT EXISTS _qb_rpc(name TEXT PRIMARY KEY,definition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _qb_policies(id TEXT PRIMARY KEY,resource TEXT NOT NULL,definition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _qb_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT NOT NULL,operation TEXT NOT NULL,pk_json TEXT NOT NULL,old_json TEXT,new_json TEXT,schema_version INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS _qb_idempotency(scope TEXT PRIMARY KEY,hash TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _qb_buckets(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,visibility TEXT NOT NULL,max_size INTEGER NOT NULL,mime_rules TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _qb_objects(id TEXT PRIMARY KEY,bucket_id TEXT NOT NULL REFERENCES _qb_buckets(id),key TEXT NOT NULL,owner_id TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,etag TEXT,state TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS _qb_objects_keys ON _qb_objects(bucket_id,key) WHERE state NOT IN('deleted','unavailable');
    CREATE INDEX IF NOT EXISTS _qb_objects_owner ON _qb_objects(owner_id,bucket_id);
  `);
  if (
    !(db.query('PRAGMA table_info(_qb_objects)').all() as any[]).some(
      (c) => c.name === 'created_at',
    )
  )
    db.exec(
      "ALTER TABLE _qb_objects ADD COLUMN created_at TEXT NOT NULL DEFAULT '';UPDATE _qb_objects SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at='';",
    );
  if (
    !(db.query('PRAGMA table_info(_qb_objects)').all() as any[]).some(
      (c) => c.name === 'content_sha',
    )
  )
    db.exec('ALTER TABLE _qb_objects ADD COLUMN content_sha TEXT');
}
export function schemaVersion(db: Database) {
  return Number(
    (db.query("SELECT value FROM _qb_meta WHERE key='schema_version'").get() as { value: string })
      .value,
  );
}
function enumValues(sql: string, column: { name: string; type: string }) {
  const name = column.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `CHECK\\s*\\(\\s*(?:"${name}"|${name})\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`,
    'i',
  ).exec(sql);
  if (!match || column.type.toUpperCase() === 'BLOB') return undefined;
  const tokens = match[1]!.match(/'(?:[^']|'')*'|-?\d+(?:\.\d+)?/g);
  if (
    !tokens ||
    tokens.length > 100 ||
    tokens.join('').replace(/\s/g, '') !== match[1]!.replace(/[,\s]/g, '')
  )
    return undefined;
  const values = tokens.map((token) =>
    token.startsWith("'")
      ? token.slice(1, -1).replaceAll("''", "'")
      : !token.includes('.') && !Number.isSafeInteger(Number(token))
        ? token
        : Number(token),
  );
  if (/INT|REAL|FLOAT|DOUBLE|NUMERIC|BOOL/i.test(column.type)) {
    if (values.some((value) => !Number.isFinite(Number(value)))) return undefined;
    return values.map((value) =>
      Number.isSafeInteger(Number(value)) || /REAL|FLOAT|DOUBLE/i.test(column.type)
        ? Number(value)
        : String(value),
    );
  }
  return values.map(String);
}
export function schema(db: Database): TableSchema[] {
  return (
    db
      .query(
        "SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_qb_%' AND sql NOT LIKE 'CREATE VIRTUAL%'",
      )
      .all() as { name: string; sql: string }[]
  ).map(({ name, sql }) => {
    const exposure = db.query('SELECT * FROM _qb_schema_exposure WHERE table_name=?').get(name) as {
      enabled: number;
      allowed_columns: string;
    } | null;
    const columns = (db.query(`PRAGMA table_xinfo(${identifier(name)})`).all() as any[])
      .filter((c) => c.hidden !== 1)
      .map((c) => ({
        name: c.name,
        type: c.type,
        nullable: !c.notnull && !c.pk,
        default: c.dflt_value,
        primaryKey: Number(c.pk),
        generated: c.hidden > 1,
        enum: enumValues(sql, { name: c.name, type: c.type }),
      }));
    return {
      name,
      columns,
      exposed: !!exposure?.enabled,
      allowedColumns: exposure ? JSON.parse(exposure.allowed_columns) : columns.map((c) => c.name),
      indexes: db.query(`PRAGMA index_list(${identifier(name)})`).all(),
      foreignKeys: db.query(`PRAGMA foreign_key_list(${identifier(name)})`).all(),
      relationships: relationships(db).filter((r) => r.source === name),
    };
  });
}
export const policies = (db: Database): Policy[] =>
  (db.query('SELECT definition FROM _qb_policies').all() as { definition: string }[]).map((p) =>
    JSON.parse(p.definition),
  );
export function savePolicy(db: Database, p: Policy, validate?: (expr: Policy['using']) => void) {
  const table = schema(db).find((t) => t.name === p.resource);
  if (!table) throw new QBError('VALIDATION', 'Unknown table');
  if (
    !['select', 'insert', 'update', 'delete'].includes(p.operation) ||
    !['permissive', 'restrictive'].includes(p.mode) ||
    !Array.isArray(p.roles) ||
    p.roles.some((r) => !['anonymous', 'authenticated', 'service'].includes(r)) ||
    typeof p.enabled !== 'boolean'
  )
    throw new QBError('INVALID_POLICY', 'Invalid policy');
  for (const expr of [p.using, p.check])
    validate
      ? validate(expr)
      : compileExpression(
          expr,
          table.columns.map((c) => c.name),
          { sub: null, role: 'anonymous' },
        );
  const id = p.id ?? crypto.randomUUID();
  db.query(
    'INSERT INTO _qb_policies VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET resource=excluded.resource,definition=excluded.definition',
  ).run(id, p.resource, JSON.stringify({ ...p, id }));
  return { ...p, id };
}
export function expose(db: Database, name: string, enabled: boolean, columns: string[]) {
  const table = schema(db).find((t) => t.name === name);
  if (
    !table ||
    !table.columns.some((c) => c.primaryKey) ||
    typeof enabled !== 'boolean' ||
    !Array.isArray(columns) ||
    !columns.length ||
    columns.some((c) => !table.columns.some((x) => x.name === c)) ||
    table.columns.some((c) => c.primaryKey && !columns.includes(c.name))
  )
    throw new QBError(
      'VALIDATION',
      'Exposure requires a primary key and valid columns, including all primary keys',
    );
  const triggers = db
    .query(
      "SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name=? AND name NOT LIKE '_qb_capture_%'",
    )
    .all(name);
  if (triggers.length)
    throw new QBError('UNSUPPORTED_TRIGGER', 'Tables with custom triggers cannot be exposed');
  db.query(
    'INSERT INTO _qb_schema_exposure VALUES(?,?,?) ON CONFLICT(table_name) DO UPDATE SET enabled=excluded.enabled,allowed_columns=excluded.allowed_columns',
  ).run(name, Number(enabled), JSON.stringify(columns));
  for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
    const trigger = `_qb_capture_${name}_${event.toLowerCase()}`;
    db.exec(`DROP TRIGGER IF EXISTS "${trigger}"`);
    if (!enabled) continue;
    const image = (prefix: string, names: string[]) =>
      `json_object(${names
        .map((n) => {
          const col = `${prefix}.${identifier(n)}`;
          const blob = table.columns.find((c) => c.name === n)?.type.toUpperCase() === 'BLOB';
          return `'${n}',${blob ? `CASE WHEN ${col} IS NULL THEN NULL ELSE 'qb_bytes:' || hex(${col}) END` : `CASE WHEN typeof(${col})='integer' AND (${col}>9007199254740991 OR ${col} < -9007199254740991) THEN CAST(${col} AS TEXT) ELSE ${col} END`}`;
        })
        .join(',')})`;
    const keys = table.columns.filter((c) => c.primaryKey).map((c) => c.name);
    const projected = table.columns.map((c) => c.name);
    db.exec(
      `CREATE TRIGGER "${trigger}" AFTER ${event} ON ${identifier(name)} BEGIN INSERT INTO _qb_outbox(table_name,operation,pk_json,old_json,new_json,schema_version) VALUES('${name}','${event.toLowerCase()}',${image(event === 'DELETE' ? 'OLD' : 'NEW', keys)},${event === 'INSERT' ? 'NULL' : image('OLD', projected)},${event === 'DELETE' ? 'NULL' : image('NEW', projected)},(SELECT value FROM _qb_meta WHERE key='schema_version')); END`,
    );
  }
}
export function generateTypes(
  tables: TableSchema[],
  version: number,
  rpc: { name: string; args: Record<string, string>; table: string }[] = [],
) {
  const type = (c: TableSchema['columns'][number]) =>
    c.enum?.length
      ? c.enum.map((value) => JSON.stringify(value)).join(' | ')
      : /BOOL/i.test(c.type)
        ? '0 | 1'
        : /INT|NUMERIC|DECIMAL/i.test(c.type)
          ? 'number | string'
          : /REAL|FLOAT|DOUBLE/i.test(c.type)
            ? 'number'
            : 'string';
  const fields = (t: TableSchema, kind: string) =>
    t.columns
      .filter((c) => !c.generated || kind === 'Row')
      .map(
        (c) =>
          `    ${JSON.stringify(c.name)}${kind === 'Update' || (kind === 'Insert' && (c.nullable || c.default !== null || (!!c.primaryKey && c.type.toUpperCase() === 'INTEGER' && t.columns.filter((c) => c.primaryKey).length === 1))) ? '?' : ''}: ${type(c)}${c.nullable ? ' | null' : ''};`,
      )
      .join('\n');
  return `// Generated by QB Flex. Schema version ${version}.\nexport interface Database {\n${tables
    .filter((t) => t.exposed)
    .map(
      (t) =>
        `  ${JSON.stringify(t.name)}: {\n${['Row', 'Insert', 'Update'].map((k) => `    ${k}: {\n${fields({ ...t, columns: t.columns.filter((c) => t.allowedColumns.includes(c.name)) }, k)}\n    };`).join('\n')}\n    Relationships: { ${(
          t.relationships ?? []
        )
          .filter((r) => tables.some((t) => t.name === r.target && t.exposed))
          .map(
            (r) =>
              `${JSON.stringify(r.name)}: Database[${JSON.stringify(r.target)}]['Row']${r.cardinality === 'many' ? '[]' : ' | null'}`,
          )
          .join('; ')} };\n  };`,
    )
    .join('\n')}\n}\nexport interface RPC {\n${rpc
    .map(
      (r) =>
        `  ${JSON.stringify(r.name)}: { Args: { ${Object.entries(r.args)
          .map(([key, type]) => `${JSON.stringify(key)}: ${type}`)
          .join('; ')} }; Returns: Database[${JSON.stringify(r.table)}]['Row'][] };`,
    )
    .join('\n')}\n}\n`;
}

export const relationships = (db: Database): Relationship[] =>
  (db.query('SELECT definition FROM _qb_relationships').all() as { definition: string }[]).map(
    (r) => JSON.parse(r.definition),
  );
export function registerRelationship(db: Database, input: Relationship) {
  identifier(input.name);
  identifier(input.source);
  identifier(input.target);
  const tables = schema(db),
    source = tables.find((t) => t.name === input.source),
    target = tables.find((t) => t.name === input.target);
  if (
    !source?.exposed ||
    !target?.exposed ||
    !source.allowedColumns.includes(input.localColumn) ||
    !target.allowedColumns.includes(input.foreignColumn) ||
    !['one', 'many'].includes(input.cardinality)
  )
    throw new QBError('VALIDATION', 'Relationships require exposed tables and columns');
  const direct = (source.foreignKeys as any[]).some(
    (f) => f.table === input.target && f.from === input.localColumn && f.to === input.foreignColumn,
  );
  const reverse = (target.foreignKeys as any[]).some(
    (f) => f.table === input.source && f.from === input.foreignColumn && f.to === input.localColumn,
  );
  if ((!direct && !reverse) || (input.cardinality === 'one' && !direct))
    throw new QBError('VALIDATION', 'Relationship must match a declared SQLite foreign key');
  db.query(
    'INSERT INTO _qb_relationships VALUES(?,?,?) ON CONFLICT(name,source) DO UPDATE SET definition=excluded.definition',
  ).run(input.name, input.source, JSON.stringify(input));
  return input;
}
export function registerRPC(db: Database, input: RPCOperation) {
  identifier(input.name);
  if (
    !['query', 'insert', 'update', 'delete'].includes(input.kind) ||
    !schema(db).some((t) => t.name === input.table && t.exposed) ||
    !input.args ||
    Object.keys(input.args).length > 20 ||
    Object.values(input.args).some((t) => !['string', 'number', 'boolean'].includes(t))
  )
    throw new QBError('VALIDATION', 'Invalid reviewed RPC declaration');
  for (const name of Object.keys(input.args)) identifier(name);
  if (['update', 'delete'].includes(input.kind) && (!input.keyArg || !(input.keyArg in input.args)))
    throw new QBError('VALIDATION', 'Key argument required');
  db.query(
    'INSERT INTO _qb_rpc VALUES(?,?) ON CONFLICT(name) DO UPDATE SET definition=excluded.definition',
  ).run(input.name, JSON.stringify(input));
  return input;
}
