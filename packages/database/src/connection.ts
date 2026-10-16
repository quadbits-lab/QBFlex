import { PGlite, types, type Transaction } from '@electric-sql/pglite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hasNumberedParameters } from './sql-guard';
import { QBError } from '@qb-flex/contracts';

/** Convert only SQL parameter tokens, never quoted strings, identifiers or comments. */
export function parameters(sql: string, offset = 0): string {
  let next = offset;
  return sql.replace(
    /('(?:''|[^'])*'|"(?:""|[^"])*"|\$([A-Za-z_][A-Za-z_0-9]*)?\$[\s\S]*?\$\2\$|--[^\n]*|\/\*[\s\S]*?\*\/)|\?/g,
    (token, protectedToken) => (protectedToken ? token : `$${++next}`),
  );
}

export class Database {
  readonly ready: Promise<PGlite>;
  private readonly context = new AsyncLocalStorage<Transaction>();
  constructor(
    readonly path = ':memory:',
    _legacyOptions?: unknown,
  ) {
    if (path !== ':memory:' && existsSync(path) && statSync(path).isFile())
      throw new QBError(
        'ENGINE_MIGRATION_REQUIRED',
        'SQLite files require offline engine conversion',
        409,
      );
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.ready = PGlite.create(path === ':memory:' ? 'memory://' : path, {
      relaxedDurability: false,
      parsers: {
        [types.NUMERIC]: (value: string) => value,
        [types.INT8]: (v: string) => {
          const n = BigInt(v);
          return n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(n)
            : v;
        },
      },
    });
  }
  private async handle() {
    return this.context.getStore() ?? (await this.ready);
  }
  query(sql: string) {
    const execute = async (values: unknown[]) =>
      (await this.handle()).query<any>(
        values.length && !hasNumberedParameters(sql) ? parameters(sql) : sql,
        values.map((v) => (typeof v === 'bigint' ? v.toString() : v)),
      );
    return {
      all: async (...values: any[]) => (await execute(values)).rows,
      get: async (...values: any[]) => (await execute(values)).rows[0] ?? null,
      run: async (...values: any[]) => ({ changes: (await execute(values)).affectedRows ?? 0 }),
    };
  }
  async exec(sql: string) {
    return (await this.handle()).exec(sql);
  }
  /** Explicit handle plus inherited transaction scope for nested domain operations. */
  transaction<T>(callback: (tx: Database) => T | Promise<T>) {
    const run = async () => {
      const existing = this.context.getStore();
      if (existing) {
        const name = 'qb_savepoint_' + crypto.randomUUID().replaceAll('-', '');
        await existing.exec(`SAVEPOINT ${name}`);
        try {
          const result = await callback(this);
          await existing.exec(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await existing.exec(`ROLLBACK TO SAVEPOINT ${name}`);
          await existing.exec(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      }
      return (await this.ready).transaction((tx) =>
        this.context.run(tx, () => Promise.resolve(callback(this))),
      );
    };
    return Object.assign(run, { immediate: run });
  }
  async snapshot(path: string, maxBytes = 1073741824) {
    if (this.context.getStore())
      throw new QBError('BACKUP_BUSY', 'Snapshots cannot run inside a transaction', 503, true);
    const pg = await this.ready;
    const { bytes } = (await this.query(
      'SELECT pg_database_size(current_database()) AS bytes',
    ).get())!;
    if (Number(bytes) > maxBytes)
      throw new QBError('SIZE_LIMIT', 'Database exceeds snapshot limit', 413);
    const data = await pg.dumpDataDir('none');
    if (data.size > maxBytes)
      throw new QBError('SIZE_LIMIT', 'Database exceeds snapshot limit', 413);
    await Bun.write(path, data, { mode: 0o600 });
  }
  async close(_force?: boolean) {
    await (await this.ready).close();
  }
}

export async function restoreDatabase(snapshot: string, destination: string) {
  const { convertSQLiteDatabase, isSQLiteFile } = await import('./legacy');
  if (isSQLiteFile(snapshot)) return convertSQLiteDatabase(snapshot, destination);
  if (existsSync(destination))
    throw new QBError('RESTORE_INVALID', 'Restore destination already exists', 409);
  const pg = await PGlite.create(destination, {
    loadDataDir: Bun.file(snapshot),
    relaxedDurability: false,
  });
  await pg.close();
}

export function databaseBytes(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  return stat.isDirectory()
    ? readdirSync(path).reduce((sum, name) => sum + databaseBytes(path + '/' + name), 0)
    : stat.size;
}
