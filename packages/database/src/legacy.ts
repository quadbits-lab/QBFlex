/** SQLite is confined to offline conversion and legacy archive recovery. */
import { Database as SQLite } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  realpathSync,
  cpSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { Database } from './connection';
import { acquireLease } from './lease';
import { QBError } from '@qb-flex/contracts';
import { initializeBranch, schema, expose } from '@qb-flex/schema';
import { BranchEngine } from './engine';

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export function isSQLiteFile(path: string) {
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(16);
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString() === 'SQLite format 3\0';
  } finally {
    closeSync(fd);
  }
}
interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}
interface Table {
  name: string;
  sql: string;
  columns: Column[];
  ddl: string;
  constraints: string[];
  indexes: string[];
}
export interface ConversionReport {
  source: string;
  tables: number;
  rows: number;
  issues: string[];
}
const authDates = new Set([
  'createdAt',
  'updatedAt',
  'expiresAt',
  'accessTokenExpiresAt',
  'refreshTokenExpiresAt',
  'lastUsedAt',
]);
// Better Auth 1.7.7 represents these boolean fields as INTEGER in SQLite.
const authBooleans = new Set(['emailVerified', 'twoFactorEnabled', 'backedUp', 'verified']);
function typeFor(table: string, c: Column) {
  if (table.startsWith('_qb_auth_') && (authBooleans.has(c.name) || /BOOL/i.test(c.type)))
    return 'boolean';
  if (table.startsWith('_qb_auth_') && (authDates.has(c.name) || /DATE|TIME/i.test(c.type)))
    return 'timestamptz';
  const t = c.type.toUpperCase();
  if (/INT/.test(t)) return 'bigint';
  if (/CHAR|CLOB|TEXT|DATE|TIME|JSON/.test(t) || t === '') return 'text';
  if (/BLOB/.test(t)) return 'bytea';
  if (/REAL|FLOA|DOUB/.test(t)) return 'double precision';
  if (/BOOL/.test(t)) return 'bigint';
  if (/NUMERIC|DECIMAL/.test(t)) return 'numeric';
  throw new Error(`Unsupported declared type ${c.type}`);
}
function valueFor(table: string, c: Column, value: any) {
  if (value === null) {
    if (c.notnull || c.pk) throw new Error('Null value violates required column');
    return null;
  }
  const t = typeFor(table, c);
  if (t === 'boolean') {
    if (value !== 0n && value !== 1n && value !== 0 && value !== 1)
      throw new Error('Expected boolean 0/1');
    return Boolean(value);
  }
  if (t === 'timestamptz') {
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      throw new Error('Auth timestamps require integer milliseconds');
    if (
      typeof value === 'string' &&
      (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || /\.\d{4,}/.test(value))
    )
      throw new Error('Auth timestamps require an explicit ISO timezone and millisecond precision');
    const date = new Date(typeof value === 'bigint' ? Number(value) : value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid auth timestamp');
    return date.toISOString();
  }
  if (t === 'bigint') {
    if (/BOOL/i.test(c.type) && ![0, 1, 0n, 1n].includes(value))
      throw new Error('Boolean column requires 0/1');
    if (typeof value !== 'bigint' && !(typeof value === 'number' && Number.isSafeInteger(value)))
      throw new Error('Mixed or noninteger value');
    return String(value);
  }
  if (t === 'text') {
    if (typeof value !== 'string') throw new Error('Mixed or nontext value');
    if (value.includes('\0')) throw new Error('PostgreSQL text cannot contain NUL bytes');
    if (/^JSON$/i.test(c.type)) {
      try {
        JSON.parse(value);
      } catch {
        throw new Error('JSON column contains invalid JSON');
      }
    }
    return value;
  }
  if (t === 'bytea') {
    if (!(value instanceof Uint8Array)) throw new Error('Mixed or nonbinary value');
    return Buffer.from(value);
  }
  if (typeof value !== 'number' && typeof value !== 'bigint')
    throw new Error('Mixed or nonnumeric value');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite number');
  return String(value);
}
function canonical(table: string, columns: Column[], row: any, source: boolean) {
  return JSON.stringify(
    columns.map((c) => {
      let v = source ? valueFor(table, c, row[c.name]) : row[c.name];
      if (v === null) return null;
      if (v instanceof Uint8Array) return ['bytes', Buffer.from(v).toString('base64')];
      if (v instanceof Date) return v.toISOString();
      if (typeFor(table, c) === 'boolean') return Boolean(v);
      return String(v);
    }),
  );
}
function defaultFor(value: string | null, type: string) {
  if (value === null) return '';
  let v = value.trim();
  if (/^(?:true|false)$/i.test(v)) {
    const n = v.toLowerCase() === 'true' ? 1 : 0;
    return type === 'boolean'
      ? ' DEFAULT ' + (n ? 'true' : 'false')
      : type === 'text'
        ? ` DEFAULT '${n}'`
        : ' DEFAULT ' + n;
  }
  if (/^\(?lower\(hex\(randomblob\(16\)\)\)\)?$/i.test(v))
    return " DEFAULT replace(gen_random_uuid()::text,'-','')";
  if (
    /^(?:\(?strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)\)?|\(?datetime\('now'\)\)?|CURRENT_TIMESTAMP)$/i.test(
      v,
    )
  )
    return type === 'timestamptz'
      ? ' DEFAULT current_timestamp'
      : ` DEFAULT to_char(current_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  if (/^\(?NULL\)?$/i.test(v)) return ' DEFAULT NULL';
  if (type === 'boolean' && /^\(?[01]\)?$/.test(v))
    return v.includes('1') ? ' DEFAULT true' : ' DEFAULT false';
  if (/^\(?-?\d+(?:\.\d+)?\)?$/.test(v) || /^'(?:[^']|'')*'$/.test(v)) return ' DEFAULT ' + v;
  if (/^X'[a-f0-9]*'$/i.test(v)) return " DEFAULT decode('" + v.slice(2, -1) + "','hex')";
  throw new Error('Unsupported default expression');
}
/** Extract balanced CHECK bodies without splitting literals or nested expressions. */
function checks(sql: string) {
  const result: string[] = [];
  const pattern = /\bCHECK\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sql))) {
    let i = pattern.lastIndex,
      start = i,
      depth = 1,
      quoted = false;
    for (; i < sql.length && depth; i++) {
      const c = sql[i];
      if (c === "'") {
        if (quoted && sql[i + 1] === "'") {
          i++;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted) {
        if (c === '(') depth++;
        if (c === ')') depth--;
      }
    }
    if (depth) throw new Error('Invalid CHECK expression');
    let body = sql.slice(start, i - 1);
    if (/\b(?:typeof|glob|regexp|collate|random|julianday)\b/i.test(body))
      throw new Error('SQLite-specific CHECK expression');
    body = body.replace(/json_valid\((\w+)\)/gi, "pg_input_is_valid($1,'json')");
    result.push('CHECK (' + body + ')');
    pattern.lastIndex = i;
  }
  return result;
}
function inventory(db: SQLite, source: string) {
  const issues: string[] = [];
  const tables: Table[] = [];
  if ((db.query('PRAGMA encoding').get() as any).encoding !== 'UTF-8')
    issues.push('Only UTF-8 SQLite databases are supported');
  let rows = 0;
  for (const object of db
    .query(
      "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name",
    )
    .all() as any[]) {
    try {
      if (object.type === 'trigger' && object.name.startsWith('_qb_capture_')) continue;
      if (object.type === 'view' || object.type === 'trigger')
        throw new Error(`Custom ${object.type} requires a reviewed PostgreSQL replacement`);
      if (object.type !== 'table') continue;
      if (Buffer.byteLength(object.name) > 63)
        throw new Error('PostgreSQL table identifier exceeds 63 bytes');
      if (/CREATE\s+VIRTUAL|\bCOLLATE\b|\bSTRICT\b/i.test(object.sql))
        throw new Error('Unsupported SQLite table feature');
      const columns = db.query(`PRAGMA table_xinfo(${quote(object.name)})`).all() as Column[];
      for (const c of columns) {
        if (Buffer.byteLength(c.name) > 63)
          throw new Error('PostgreSQL column identifier exceeds 63 bytes');
        c.pk = Number(c.pk);
        c.hidden = Number(c.hidden);
        c.notnull = Number(c.notnull);
      }
      if (columns.some((c) => c.hidden))
        throw new Error('Generated or hidden columns require reviewed conversion');
      const primary = columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
      const definitions = columns.map((c) => {
        const type = typeFor(object.name, c),
          identity = primary.length === 1 && c.pk && c.type.toUpperCase() === 'INTEGER';
        return `${quote(c.name)} ${type}${identity ? ' GENERATED BY DEFAULT AS IDENTITY' : ''}${c.notnull || c.pk ? ' NOT NULL' : ''}${identity ? '' : defaultFor(c.dflt_value, type)}`;
      });
      if (primary.length)
        definitions.push(`PRIMARY KEY (${primary.map((c) => quote(c.name)).join(',')})`);
      definitions.push(...checks(object.sql));
      for (const c of columns) {
        if (/^JSON$/i.test(c.type))
          definitions.push(`CHECK (pg_input_is_valid(${quote(c.name)},'json'))`);
        if (/BOOL/i.test(c.type) && typeFor(object.name, c) === 'bigint')
          definitions.push(`CHECK (${quote(c.name)} IN (0,1))`);
      }
      const constraints: string[] = [];
      const fk = db.query(`PRAGMA foreign_key_list(${quote(object.name)})`).all() as any[];
      for (const id of new Set(fk.map((f) => f.id))) {
        const group = fk.filter((f) => f.id === id).sort((a, b) => Number(a.seq) - Number(b.seq));
        const f = group[0];
        if (group.some((f) => !f.to))
          throw new Error('Implicit foreign-key target requires reviewed conversion');
        constraints.push(
          `ALTER TABLE ${quote(object.name)} ADD FOREIGN KEY (${group.map((f) => quote(f.from)).join(',')}) REFERENCES ${quote(f.table)} (${group.map((f) => quote(f.to)).join(',')}) ON UPDATE ${f.on_update} ON DELETE ${f.on_delete} DEFERRABLE INITIALLY DEFERRED`,
        );
      }
      const indexes: string[] = [];
      for (const idx of db.query(`PRAGMA index_list(${quote(object.name)})`).all() as any[]) {
        if (idx.origin === 'pk') continue;
        if (!idx.name.startsWith('sqlite_') && Buffer.byteLength(idx.name) > 63)
          throw new Error('PostgreSQL index identifier exceeds 63 bytes');
        const indexed = (db.query(`PRAGMA index_xinfo(${quote(idx.name)})`).all() as any[]).filter(
          (c) => Number(c.key) === 1,
        );
        if (indexed.some((c) => c.coll !== 'BINARY'))
          throw new Error('Nonbinary index collation requires reviewed conversion');
        if (indexed.some((c) => !c.name))
          throw new Error('Expression indexes require reviewed conversion');
        const original = (
          db.query('SELECT sql FROM sqlite_schema WHERE name=?').get(idx.name) as any
        )?.sql;
        const where = original ? /\bWHERE\s+([\s\S]+)$/i.exec(original)?.[1] : undefined;
        if (where && /\b(?:typeof|glob|collate|json_extract)\b/i.test(where))
          throw new Error('Unsupported partial index predicate');
        const indexName = idx.name.startsWith('sqlite_')
          ? '_qb_legacy_index_' +
            createHash('sha256')
              .update(object.name + idx.name)
              .digest('hex')
              .slice(0, 20)
          : idx.name;
        indexes.push(
          `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${quote(indexName)} ON ${quote(object.name)} (${indexed.map((c) => quote(c.name) + (Number(c.desc) ? ' DESC' : ' ASC')).join(',')})${where ? ' WHERE ' + where : ''}`,
        );
      }
      // SQLite TEXT can contain invalid UTF-8; never silently decode/re-encode those bytes.
      for (const c of columns.filter((c) => typeFor(object.name, c) === 'text')) {
        for (const raw of db
          .query(
            `SELECT CAST(${quote(c.name)} AS BLOB) AS bytes FROM ${quote(object.name)} WHERE typeof(${quote(c.name)})='text'`,
          )
          .iterate() as Iterable<any>) {
          const bytes = Buffer.from(raw.bytes);
          if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes))
            throw new Error('PostgreSQL text requires valid UTF-8');
        }
      }
      // Preflight every value without retaining source row data in the report.
      for (const row of db
        .query(`SELECT * FROM ${quote(object.name)}`)
        .iterate() as Iterable<any>) {
        for (const c of columns) valueFor(object.name, c, row[c.name]);
        rows++;
      }
      tables.push({
        name: object.name,
        sql: object.sql,
        columns,
        ddl: `CREATE TABLE ${quote(object.name)} (${definitions.join(',')})`,
        constraints,
        indexes,
      });
    } catch (error) {
      issues.push(
        `${object.name}: ${error instanceof Error ? error.message : 'Unsupported object'}`,
      );
    }
  }
  if (
    (db.query('PRAGMA integrity_check').get() as any).integrity_check !== 'ok' ||
    db.query('PRAGMA foreign_key_check').all().length
  )
    issues.push('SQLite integrity/foreign-key validation failed');
  return {
    tables,
    report: { source, tables: tables.length, rows, issues } satisfies ConversionReport,
  };
}
export function inspectSQLiteDatabase(source: string) {
  const db = new SQLite(source, { readonly: true, safeIntegers: true });
  try {
    return inventory(db, source).report;
  } finally {
    db.close();
  }
}
export async function convertSQLiteDatabase(source: string, destination: string) {
  if (existsSync(destination))
    throw new QBError('MIGRATION_DESTINATION', 'Destination already exists', 409);
  const sqlite = new SQLite(source, { readonly: true, safeIntegers: true });
  let target: Database | undefined;
  try {
    const { tables, report } = inventory(sqlite, source);
    if (report.issues.length)
      throw new QBError('MIGRATION_INCOMPATIBLE', report.issues.join('; '), 409);
    target = new Database(destination);
    await target.ready;
    await target
      .transaction(async (tx) => {
        for (const t of tables) await tx.exec(t.ddl);
        for (const t of tables) {
          const sourceHash = createHash('sha256'),
            destHash = createHash('sha256');
          // Bounded batches; insertion order is compared immediately, without relying on SQL row ordering.
          for (const row of sqlite
            .query(`SELECT * FROM ${quote(t.name)}`)
            .iterate() as Iterable<any>) {
            sourceHash.update(canonical(t.name, t.columns, row, true) + '\n');
            const result = await tx
              .query(
                `INSERT INTO ${quote(t.name)} (${t.columns.map((c) => quote(c.name)).join(',')}) VALUES(${t.columns.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
              )
              .get(...t.columns.map((c) => valueFor(t.name, c, row[c.name])));
            destHash.update(canonical(t.name, t.columns, result, false) + '\n');
          }
          if (sourceHash.digest('hex') !== destHash.digest('hex'))
            throw new QBError(
              'MIGRATION_VALIDATION',
              `Content verification failed: ${t.name}`,
              409,
            );
          const count = Number(
            (await tx.query(`SELECT count(*) AS n FROM ${quote(t.name)}`).get())!.n,
          );
          if (
            count !==
            Number((sqlite.query(`SELECT count(*) AS n FROM ${quote(t.name)}`).get() as any).n)
          )
            throw new QBError('MIGRATION_VALIDATION', `Row count differs: ${t.name}`, 409);
          for (const index of t.indexes) await tx.exec(index);
        }
        for (const t of tables) for (const constraint of t.constraints) await tx.exec(constraint);
        await tx.exec('SET CONSTRAINTS ALL IMMEDIATE');
        for (const t of tables)
          for (const c of t.columns.filter(
            (c) =>
              c.pk &&
              c.type.toUpperCase() === 'INTEGER' &&
              t.columns.filter((c) => c.pk).length === 1,
          )) {
            const maximum = String(
              (await tx
                .query(`SELECT COALESCE(max(${quote(c.name)}),0) AS n FROM ${quote(t.name)}`)
                .get())!.n,
            );
            const oldSequence = sqlite
              .query("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'")
              .get()
              ? (sqlite.query('SELECT seq FROM sqlite_sequence WHERE name=?').get(t.name) as any)
                  ?.seq
              : 0;
            const next =
              BigInt(maximum) > BigInt(oldSequence ?? 0)
                ? String(maximum)
                : String(oldSequence ?? 0);
            if (BigInt(next) > 0n)
              await tx
                .query('SELECT setval(pg_get_serial_sequence($1,$2),$3::bigint,true)')
                .get(quote(t.name), c.name, next);
          }
        if (tables.some((t) => t.name === '_qb_meta')) {
          await initializeBranch(tx);
          await tx.query("DELETE FROM _qb_meta WHERE key='physical_schema_hash'").run();
          const exposed = await schema(tx);
          for (const t of exposed.filter((t) => t.exposed))
            await expose(tx, t.name, true, t.allowedColumns);
          await tx
            .query(
              "INSERT INTO _qb_meta VALUES('engine_baseline','sqlite-to-pglite-v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run();
        }
        if (tables.some((t) => t.name === 'control_migrations')) {
          await tx.exec(
            'CREATE TABLE IF NOT EXISTS engine_migrations(id TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)',
          );
          for (const name of [
            '001-foundation',
            '002-credentials',
            '003-delivery-security',
            '004-workspace-lifecycle',
            '005-recovery',
            '006-reviews-previews',
          ]) {
            const sql = readFileSync(
              new URL(`../../../migrations/pglite/${name}.sql`, import.meta.url),
              'utf8',
            );
            await tx.exec(sql);
            await tx
              .query('INSERT INTO engine_migrations VALUES($1,$2,$3)')
              .run(name, createHash('sha256').update(sql).digest('hex'), new Date().toISOString());
          }
        }
      })
      .immediate();
    if (tables.some((t) => t.name === '_qb_meta')) {
      const engine = await new BranchEngine(target, 'conversion-validation').initialize();
      const principal = tables.some((t) => t.name === '_qb_auth_users')
        ? (await target.query('SELECT id FROM _qb_auth_users LIMIT 1').get())?.id
        : undefined;
      for (const table of (await schema(target)).filter((t) => t.exposed)) {
        for (const role of ['anonymous', 'authenticated', 'service'] as const) {
          for (const operation of ['select', 'insert', 'update', 'delete'] as const) {
            for (const phase of ['using', 'check'] as const) {
              try {
                const compiled = engine.policy(
                  table,
                  operation,
                  {
                    role,
                    sub: role === 'anonymous' ? null : (principal ?? 'conversion-validation'),
                  },
                  phase,
                );
                await target
                  .query(
                    `SELECT (${compiled.sql}) AS permitted FROM ${quote(table.name)} AS "qb_row_0" LIMIT 1`,
                  )
                  .get(...compiled.params);
              } catch {
                throw new QBError(
                  'MIGRATION_INCOMPATIBLE',
                  `Authorization query requires review: ${table.name}, ${role}, ${operation}/${phase}`,
                  409,
                );
              }
            }
          }
        }
      }
    }
    await target.close();
    target = undefined;
    return report;
  } catch (error) {
    if (target) await target.close().catch(() => {});
    rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    sqlite.close();
  }
}
function canonicalPath(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute)
    ? realpathSync(absolute)
    : join(canonicalPath(dirname(absolute)), relative(dirname(absolute), absolute));
}
function assertNoSymlinks(path: string) {
  for (const e of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, e.name);
    if (e.isSymbolicLink())
      throw new QBError(
        'MIGRATION_PATH',
        'Symlinks in the data directory require manual review',
        409,
      );
    if (e.isDirectory()) assertNoSymlinks(p);
  }
}
export async function migrateEngine(options: {
  dataDir: string;
  outputDir: string;
  check?: boolean;
}) {
  const source = canonicalPath(options.dataDir),
    destination = canonicalPath(options.outputDir);
  const rel = relative(source, destination),
    reverse = relative(destination, source);
  if (
    !rel ||
    (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)) ||
    (reverse !== '..' && !reverse.startsWith('../') && !isAbsolute(reverse))
  )
    throw new QBError('MIGRATION_PATH', 'Source and destination must not overlap', 409);
  if (existsSync(destination) && readdirSync(destination).length)
    throw new QBError('MIGRATION_DESTINATION', 'Destination must be empty', 409);
  if (!existsSync(source) || !lstatSync(source).isDirectory())
    throw new QBError('MIGRATION_PATH', 'Source must be an existing data directory', 409);
  assertNoSymlinks(source);
  const release = acquireLease(source, false);
  let legacyLock: SQLite | undefined;
  try {
    const lock = join(source, '.owner.sqlite');
    if (existsSync(lock)) {
      legacyLock = new SQLite(lock, { readwrite: true });
      try {
        legacyLock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
      } catch {
        throw new QBError('OWNER_LOCK', 'Stop the legacy API before conversion', 503);
      }
    }
    const control = join(source, 'control.sqlite');
    const db = new SQLite(control, { readonly: true, safeIntegers: true });
    let branches: any[];
    try {
      branches = db.query('SELECT id,project_id FROM branches').all() as any[];
    } finally {
      db.close();
    }
    const databases = [
      { from: control, to: join(destination, 'control.pglite') },
      ...branches.map((b) => {
        if (![b.id, b.project_id].every((v) => /^[a-f0-9-]{36}$/.test(v)))
          throw new QBError('MIGRATION_PATH', 'Invalid catalog branch identifier', 409);
        return {
          from: join(source, 'projects', b.project_id, 'branches', b.id, 'main.sqlite'),
          to: join(destination, 'projects', b.project_id, 'branches', b.id, 'main.pglite'),
        };
      }),
    ];
    const reports = databases.map((d) => inspectSQLiteDatabase(d.from));
    if (options.check)
      return { compatible: reports.every((r) => !r.issues.length), databases: reports };
    if (reports.some((r) => r.issues.length))
      throw new QBError(
        'MIGRATION_INCOMPATIBLE',
        reports
          .flatMap((r) => r.issues.map((i) => `${relative(source, r.source)}: ${i}`))
          .join('; '),
        409,
      );
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(destination, 'engine.migrating.json'),
      JSON.stringify({ source, engine: 'pglite', complete: false }),
      { flag: 'wx', mode: 0o600 },
    );
    try {
      for (const e of readdirSync(source, { withFileTypes: true })) {
        if (
          [
            'control.sqlite',
            'control.sqlite-wal',
            'control.sqlite-shm',
            '.owner.sqlite',
            '.owner.sqlite-journal',
            '.owner.flock',
            'owner.lock',
            'projects',
            'transfers',
          ].includes(e.name)
        )
          continue;
        cpSync(join(source, e.name), join(destination, e.name), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      }
      for (const d of databases) await convertSQLiteDatabase(d.from, d.to);
      // Rewrite only references into the copied backup tree; encrypted archive bytes stay identical.
      const catalog = new Database(join(destination, 'control.pglite'));
      try {
        for (const b of await catalog.query('SELECT id,path FROM backups').all()) {
          const resolved = canonicalPath(b.path),
            r = relative(source, resolved);
          if (r && r !== '..' && !r.startsWith('../') && !isAbsolute(r)) {
            const path = join(destination, r);
            if (!existsSync(path))
              throw new QBError('MIGRATION_VALIDATION', 'Referenced backup is missing', 409);
            await catalog.query('UPDATE backups SET path=$1 WHERE id=$2').run(path, b.id);
          } else if (!existsSync(resolved))
            throw new QBError('MIGRATION_VALIDATION', 'Referenced external backup is missing', 409);
        }
      } finally {
        await catalog.close();
      }
      const manifest = {
        engine: 'pglite',
        format: 1,
        complete: true,
        source,
        createdAt: new Date().toISOString(),
        databases: reports,
      };
      writeFileSync(join(destination, 'engine.json'), JSON.stringify(manifest, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      rmSync(join(destination, 'engine.migrating.json'));
      return manifest;
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  } finally {
    legacyLock?.close();
    release();
  }
}
