import type { Database } from './connection';
import { safeSQL } from './sql-guard';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  QBError,
  type Identity,
  type Policy,
  type Query,
  type TableSchema,
  type Expression,
} from '@qb-flex/contracts';
import {
  schema,
  schemaVersion,
  policies,
  expose,
  savePolicy,
  generateTypes,
  relationships,
} from '@qb-flex/schema';
import { compilePolicies, compileExpression, identifier } from '@qb-flex/policies';
import { compileQuery, cursorCodec, normalize, sqlValue, columnValue } from '@qb-flex/query-engine';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class BranchEngine {
  private catalog: TableSchema[] = [];
  private policyCatalog: Policy[] = [];
  private relationCatalog: Awaited<ReturnType<typeof relationships>> = [];
  async refresh() {
    this.catalog = await schema(this.db);
    this.policyCatalog = await policies(this.db);
    this.relationCatalog = await relationships(this.db);
  }
  constructor(
    public db: Database,
    private secret: string,
  ) {}
  async initialize() {
    if (!(await this.db.query("SELECT value FROM _qb_meta WHERE key='physical_schema_hash'").get()))
      await this.stampSchema();
    await this.refresh();
    return this;
  }
  private async physicalSchema() {
    return hash(
      await this.db
        .query(
          `SELECT c.relkind AS type,c.relname AS name,
          (SELECT json_agg(json_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),(SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=a.atttypid)) ORDER BY a.attnum)::text
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
           WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
          (SELECT json_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname)::text FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
          (SELECT json_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid::regclass::text)::text FROM pg_index i WHERE i.indrelid=c.oid) AS indexes,
          (SELECT json_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname)::text FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND left(t.tgname,12)<>'_qb_capture_') AS triggers,
          CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid) ELSE NULL END AS view
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN('r','v') AND left(c.relname,4)<>'_qb_' ORDER BY c.relkind,c.relname`,
        )
        .all(),
    );
  }
  private async stampSchema() {
    await this.db
      .query(
        "INSERT INTO _qb_meta VALUES('physical_schema_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(await this.physicalSchema());
  }
  async assertSchema() {
    await this.refresh();
    const expected = (await this.db
      .query("SELECT value FROM _qb_meta WHERE key='physical_schema_hash'")
      .get()) as any;
    if (expected?.value !== (await this.physicalSchema()))
      throw new QBError(
        'SCHEMA_STALE',
        'Physical schema changed outside migrations; reconcile with a reviewed migration',
        409,
      );
  }
  table(name: string, publicOnly = true) {
    const table = this.catalog.find((t) => t.name === name);
    if (!table || (publicOnly && !table.exposed))
      throw new QBError('NOT_FOUND', 'Table not available', 404);
    return table;
  }
  expressionOptions(table: TableSchema, identity: Identity, stack: string[] = []) {
    const alias = `qb_row_${stack.length}`;
    return {
      alias,
      columnTypes: Object.fromEntries(table.columns.map((c) => [c.name, c.type])),
      exists: (
        expression: Extract<
          Expression,
          {
            op: 'exists';
          }
        >,
      ) => {
        if (stack.length >= 4 || stack.includes(table.name))
          throw new QBError('INVALID_POLICY', 'Cyclic or deep relationship policy');
        const relation = this.relationCatalog.find(
          (r) => r.source === table.name && r.name === expression.relationship,
        );
        if (!relation) throw new QBError('INVALID_POLICY', 'Relationship is not approved');
        const target = this.table(relation.target);
        const nextStack = [...stack, table.name],
          options = this.expressionOptions(target, identity, nextStack);
        const condition = compileExpression(
          expression.where,
          target.columns.map((c) => c.name),
          identity,
          0,
          options,
        );
        const policy = compilePolicies(
          this.policyCatalog,
          target.name,
          'select',
          target.columns.map((c) => c.name),
          identity,
          'using',
          options,
        );
        return {
          sql: `EXISTS(SELECT 1 FROM ${identifier(target.name)} AS "${options.alias}" WHERE "${options.alias}".${identifier(relation.foreignColumn)} = "${alias}".${identifier(relation.localColumn)} AND (${policy.sql}) AND (${condition.sql}))`,
          params: [...policy.params, ...condition.params],
        };
      },
    };
  }
  policy(
    table: TableSchema,
    operation: 'select' | 'insert' | 'update' | 'delete',
    identity: Identity,
    phase: 'using' | 'check' = 'using',
  ) {
    return compilePolicies(
      this.policyCatalog,
      table.name,
      operation,
      table.columns.map((c) => c.name),
      identity,
      phase,
      this.expressionOptions(table, identity),
    );
  }
  async savePolicy(policy: any) {
    await this.refresh();
    const table = this.table(policy.resource, false);
    return await savePolicy(this.db, policy, (expr) => {
      compileExpression(
        expr,
        table.columns.map((c) => c.name),
        { sub: null, role: 'anonymous', roles: [] },
        0,
        this.expressionOptions(table, { sub: null, role: 'anonymous', roles: [] }),
      );
    });
  }
  async read(
    name: string,
    q: Query,
    identity: Identity,
    privileged = false,
    budget = { remaining: 2097152 },
  ) {
    await this.assertSchema();
    const table = this.table(name, !privileged);
    const policy = privileged
      ? { sql: 'TRUE', params: [] }
      : this.policy(table, 'select', identity);
    const compiled = compileQuery(
      privileged ? { ...table, allowedColumns: table.columns.map((c) => c.name) } : table,
      q,
      policy,
    );
    let sql = compiled.sql;
    const params = [...compiled.params];
    const codec = cursorCodec(this.secret);
    const version = await schemaVersion(this.db);
    const scope = codec.scope(name, q, identity, version);
    const count = q.count
      ? Number(
          (
            (await this.db
              .query(`SELECT COUNT(*) AS total FROM (${sql})`)
              .get(...(params as any[]))) as any
          ).total,
        )
      : undefined;
    if (q.cursor) {
      const decoded = codec.decode(q.cursor);
      if (
        decoded.scope !== scope ||
        !Array.isArray(decoded.values) ||
        decoded.values.length !== compiled.order.length
      )
        throw new QBError('INVALID_CURSOR', 'Cursor scope or schema changed');
      const terms = compiled.order.map((o, i) => {
        const prefix = compiled.order.slice(0, i).map((p, j) => {
          params.push(
            columnValue(
              table.columns.find((column) => column.name === p.column)!,
              decoded.values[j],
            ),
          );
          return `${identifier(p.column)} IS NOT DISTINCT FROM ?`;
        });
        const v = decoded.values[i];
        const col = identifier(o.column);
        let comparison: string;
        if (v === null) comparison = o.direction === 'asc' ? `${col} IS NOT NULL` : 'FALSE';
        else {
          params.push(
            columnValue(
              table.columns.find((column) => column.name === o.column)!,
              v,
            ),
          );
          comparison = o.direction === 'asc' ? `${col} > ?` : `(${col} < ? OR ${col} IS NULL)`;
        }
        return `(${[...prefix, comparison].join(' AND ')})`;
      });
      sql += ` AND (${terms.join(' OR ')})`;
    }
    sql += ` ORDER BY ${compiled.order.map((o) => `${identifier(o.column)} ${o.direction.toUpperCase()} NULLS ${o.direction === 'asc' ? 'FIRST' : 'LAST'}`).join(',')} LIMIT ?`;
    params.push(compiled.limit + 1);
    // Measure in PostgreSQL before materializing large values in the owner process.
    // Six bytes per input byte also bounds JSON escaping and base64 overhead.
    const fetchedColumns = [
      ...new Set([...compiled.selected, ...compiled.order.map((o) => o.column)]),
    ];
    const cost = fetchedColumns
      .map(
        (name) => `COALESCE(octet_length(${identifier(name)}::text),0)*6+${name.length * 6 + 32}`,
      )
      .join('+');
    const bytes = Number(
      (
        (await this.db
          .query(`SELECT COALESCE(SUM(${cost}),0) AS bytes FROM (${sql})`)
          .get(...(params as any[]))) as any
      ).bytes,
    );
    if (bytes > budget.remaining)
      throw new QBError(
        'RESULT_TOO_LARGE',
        'Result exceeds 2 MiB; select fewer columns or reduce the page size',
        413,
      );
    budget.remaining -= bytes;
    const all = (await this.db.query(sql).all(...(params as any[]))).map((row) =>
      this.rowWire(table, row),
    ) as Record<string, any>[];
    const hasNext = all.length > compiled.limit;
    const rows = all.slice(0, compiled.limit);
    const last = rows.at(-1);
    const cursor =
      hasNext && last
        ? codec.encode({ scope, values: compiled.order.map((o) => last[o.column]) })
        : undefined;
    const projected = rows.map((r) => Object.fromEntries(compiled.selected.map((c) => [c, r[c]])));
    if (q.relations) {
      if (!Array.isArray(q.relations) || q.relations.length > 3 || compiled.limit > 100)
        throw new QBError(
          'VALIDATION',
          'Relations support at most three links and 100 parent rows',
        );
      for (const requested of q.relations) {
        const relation = this.relationCatalog.find(
          (r) => r.source === name && r.name === requested.name,
        );
        if (!relation) throw new QBError('VALIDATION', 'Relationship not registered');
        if (!compiled.selected.includes(relation.localColumn))
          throw new QBError('VALIDATION', 'Select the relationship local column');
        if (!Number.isInteger(requested.limit ?? 50) || (requested.limit ?? 50) > 50)
          throw new QBError('VALIDATION', 'Related page limit must be 1–50');
        for (let i = 0; i < rows.length; i++) {
          const value = rows[i][relation.localColumn];
          const related =
            value === null
              ? []
              : (
                  await this.read(
                    relation.target,
                    {
                      columns: requested.columns,
                      filters: [{ column: relation.foreignColumn, op: 'eq', value }],
                      limit: relation.cardinality === 'one' ? 1 : (requested.limit ?? 50),
                    },
                    identity,
                    privileged,
                    budget,
                  )
                ).data;
          projected[i][relation.name] =
            relation.cardinality === 'one' ? (related[0] ?? null) : related;
        }
      }
    }
    return {
      data: projected,
      meta: {
        schemaVersion: version,
        cursor,
        count,
        consistencyToken: String(await this.latest()),
      },
    };
  }
  private rowWire(table: TableSchema, row: Record<string, any>) {
    return Object.fromEntries(
      Object.entries(row).map(([name, value]) => {
        const type = table.columns.find((c) => c.name === name)?.type ?? '';
        return [
          name,
          value === null
            ? null
            : /^(?:boolean|bool)$/i.test(type)
              ? Number(value)
              : /^jsonb?$/i.test(type)
                ? JSON.stringify(value)
                : normalize(value),
        ];
      }),
    );
  }
  async checkRow(
    table: TableSchema,
    row: Record<string, unknown>,
    identity: Identity,
    operation: 'insert' | 'update',
    privileged: boolean,
  ) {
    if (privileged) return;
    const p = this.policy(table, operation, identity, 'check');
    const names = table.columns.map((c) => c.name);
    const sql = `SELECT (${p.sql}) AS permitted FROM (SELECT ${names.map((n) => `?::${table.columns.find((c) => c.name === n)!.type} AS ${identifier(n)}`).join(',')}) AS "qb_row_0"`;
    const result = (await this.db
      .query(sql)
      .get(...([...p.params, ...names.map((n) => row[n] ?? null)] as any[]))) as any;
    if (!result?.permitted)
      throw new QBError('DENIED', 'Row does not satisfy the write policy', 403);
  }
  key(table: TableSchema, key: string) {
    const pks = table.columns
      .filter((c) => c.primaryKey)
      .sort((a, b) => a.primaryKey - b.primaryKey);
    let values: unknown[];
    if (pks.length === 1) values = [key];
    else {
      try {
        values = JSON.parse(Buffer.from(key, 'base64url').toString());
      } catch {
        throw new QBError('VALIDATION', 'Composite key must be a base64url JSON array');
      }
      if (!Array.isArray(values) || values.length !== pks.length)
        throw new QBError('VALIDATION', 'Invalid composite key');
    }
    return {
      sql: pks.map((c) => `${identifier(c.name)}=?`).join(' AND '),
      params: values.map((value, index) => columnValue(pks[index]!, value)),
    };
  }
  async mutate(
    name: string,
    method: string,
    input: any,
    identity: Identity,
    key?: string,
    idempotency?: string,
    privileged = false,
    revision?: number,
  ) {
    await this.assertSchema();
    const table = this.table(name, !privileged);
    const columns = table.columns.filter((c) => !c.generated).map((c) => c.name);
    const allowed = privileged ? columns : table.allowedColumns;
    const digest = hash({ method, input, key, revision });
    const scope = idempotency ? hash({ identity, name, method, key, idempotency }) : undefined;
    return await this.db
      .transaction(async (tx) => {
        if (scope) {
          const old = (await tx
            .query('SELECT hash,response FROM _qb_idempotency WHERE scope=?')
            .get(scope)) as any;
          if (old) {
            if (old.hash !== digest)
              throw new QBError('IDEMPOTENCY_CONFLICT', 'Key reused with different content', 409);
            return JSON.parse(old.response);
          }
        }
        const checkInput = (row: Record<string, unknown>) => {
          if (
            !row ||
            typeof row !== 'object' ||
            Array.isArray(row) ||
            Object.keys(row).some((c) => !allowed.includes(c) || !columns.includes(c))
          )
            throw new QBError('VALIDATION', 'Unknown, hidden or generated column');
          for (const [name, value] of Object.entries(row))
            columnValue(
              table.columns.find((column) => column.name === name)!,
              value,
            );
        };
        const output: Record<string, unknown>[] = [];
        if (method === 'insert' || method === 'upsert') {
          const rows = Array.isArray(input) ? input : [input];
          if (!rows.length || rows.length > 100)
            throw new QBError('VALIDATION', 'Batch must contain 1–100 rows');
          for (const row of rows) {
            checkInput(row);
            const names = Object.keys(row);
            if (method === 'upsert') {
              const primary = table.columns
                .filter((c) => c.primaryKey)
                .sort((a, b) => a.primaryKey - b.primaryKey);
              if (primary.some((c) => row[c.name] === undefined))
                throw new QBError('VALIDATION', 'Upsert requires all primary key fields');
              const where = primary.map((c) => `${identifier(c.name)}=?`).join(' AND ');
              const params = primary.map((c) => columnValue(c, row[c.name]));
              const old = (await tx
                .query(`SELECT * FROM ${identifier(name)} AS "qb_row_0" WHERE ${where}`)
                .get(...(params as any[]))) as Record<string, unknown> | null;
              if (old) {
                const policy = privileged
                  ? { sql: 'TRUE', params: [] }
                  : this.policy(table, 'update', identity);
                const permitted = await tx
                  .query(
                    `SELECT 1 FROM ${identifier(name)} AS "qb_row_0" WHERE ${where} AND (${policy.sql})`,
                  )
                  .get(...([...params, ...policy.params] as any[]));
                if (!permitted) throw new QBError('NOT_FOUND', 'Row not available', 404);
                if (revision !== undefined && Number(old.revision) !== revision)
                  throw new QBError('CONFLICT', 'Row changed since it was read', 409);
                const fields = names.filter((n) => !primary.some((c) => c.name === n));
                if (fields.includes('revision'))
                  throw new QBError('VALIDATION', 'Revision is managed by the server');
                if (fields.length) {
                  const actual = (await tx
                    .query(
                      `UPDATE ${identifier(name)} AS "qb_row_0" SET ${fields.map((n) => `${identifier(n)}=?`).join(',')}${columns.includes('revision') ? ',revision=revision+1' : ''} WHERE ${where} RETURNING *`,
                    )
                    .get(
                      ...([
                        ...fields.map((n) =>
                          columnValue(
                            table.columns.find((column) => column.name === n)!,
                            row[n],
                          ),
                        ),
                        ...params,
                      ] as any[]),
                    )) as Record<string, unknown>;
                  await this.checkRow(table, actual, identity, 'update', privileged);
                  output.push(actual);
                } else {
                  await this.checkRow(table, old, identity, 'update', privileged);
                  output.push(old);
                }
                continue;
              }
            }
            const statement = names.length
              ? `INSERT INTO ${identifier(name)} (${names.map(identifier).join(',')}) VALUES(${names.map(() => '?').join(',')}) RETURNING *`
              : `INSERT INTO ${identifier(name)} DEFAULT VALUES RETURNING *`;
            const actual = (await tx.query(statement).get(
              ...(names.map((n) =>
                columnValue(
                  table.columns.find((column) => column.name === n)!,
                  row[n],
                ),
              ) as any[]),
            )) as Record<string, unknown>;
            if (table.columns.some((c) => c.primaryKey && actual[c.name] === null))
              throw new QBError('VALIDATION', 'Primary keys cannot be null');
            await this.checkRow(table, actual, identity, 'insert', privileged);
            output.push(actual);
          }
        } else {
          if (!key) throw new QBError('VALIDATION', 'Row key is required');
          const pk = this.key(table, key);
          const p = privileged
            ? { sql: 'TRUE', params: [] }
            : this.policy(table, method === 'delete' ? 'delete' : 'update', identity);
          const where = `(${pk.sql}) AND (${p.sql})`;
          const params = [...pk.params, ...p.params];
          const old = (await tx
            .query(`SELECT * FROM ${identifier(name)} AS "qb_row_0" WHERE ${where}`)
            .get(...(params as any[]))) as Record<string, unknown> | null;
          if (!old) throw new QBError('NOT_FOUND', 'Row not available', 404);
          if (revision !== undefined && Number(old.revision) !== revision)
            throw new QBError('CONFLICT', 'Row changed since it was read', 409);
          if (method === 'delete') {
            await tx
              .query(`DELETE FROM ${identifier(name)} AS "qb_row_0" WHERE ${where}`)
              .run(...(params as any[]));
          } else {
            checkInput(input);
            const names = Object.keys(input);
            if (!names.length) throw new QBError('VALIDATION', 'No update fields');
            if (table.columns.some((c) => c.primaryKey && names.includes(c.name)))
              throw new QBError('VALIDATION', 'Primary keys cannot be updated');
            if (names.includes('revision'))
              throw new QBError('VALIDATION', 'Revision is managed by the server');
            const actual = (await tx
              .query(
                `UPDATE ${identifier(name)} AS "qb_row_0" SET ${names.map((n) => `${identifier(n)}=?`).join(',')}${columns.includes('revision') ? ',revision=revision+1' : ''} WHERE ${where} RETURNING *`,
              )
              .get(
                ...([
                  ...names.map((n) =>
                    columnValue(
                      table.columns.find((column) => column.name === n)!,
                      input[n],
                    ),
                  ),
                  ...params,
                ] as any[]),
              )) as Record<string, unknown>;
            await this.checkRow(table, actual, identity, 'update', privileged);
            output.push(actual);
          }
        }
        const readable = [];
        for (const row of output)
          if (privileged || (await this.visible(table, row, identity))) readable.push(row);
        const response = {
          data: normalize(
            readable.map((row) =>
              Object.fromEntries(
                (privileged ? columns : table.allowedColumns).map((n) => [
                  n,
                  this.rowWire(table, row)[n],
                ]),
              ),
            ),
          ),
          meta: {
            schemaVersion: await schemaVersion(tx),
            consistencyToken: String(await this.latest()),
          },
        };
        if (scope)
          await tx
            .query('INSERT INTO _qb_idempotency VALUES(?,?,?,?)')
            .run(scope, digest, JSON.stringify(response), new Date().toISOString());
        return response;
      })
      .immediate();
  }
  async visible(table: TableSchema, row: Record<string, unknown>, identity: Identity) {
    const p = this.policy(table, 'select', identity);
    const names = table.columns.map((c) => c.name);
    return !!(
      (await this.db
        .query(
          `SELECT (${p.sql}) AS permitted FROM (SELECT ${names.map((n) => `?::${table.columns.find((c) => c.name === n)!.type} AS ${identifier(n)}`).join(',')}) AS "qb_row_0"`,
        )
        .get(...([...p.params, ...names.map((n) => row[n] ?? null)] as any[]))) as any
    )?.permitted;
  }
  async migration(id: string, sql: string, author: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || typeof sql !== 'string' || sql.length > 262144)
      throw new QBError('VALIDATION', 'Invalid migration');
    this.safeSQL(sql);
    const checksum = hash(sql);
    const previous = (await this.db
      .query('SELECT checksum FROM _qb_migrations WHERE id=?')
      .get(id)) as any;
    if (previous) {
      if (previous.checksum !== checksum)
        throw new QBError('MIGRATION_CHANGED', 'Applied checksum does not match', 409);
      return { id, alreadyApplied: true };
    }
    return await this.db
      .transaction(async (tx) => {
        await tx.exec(sql);
        await tx.exec(
          "UPDATE _qb_meta SET value=(value::bigint+1)::text WHERE key='schema_version'",
        );
        for (const t of (await schema(tx)).filter((t) => t.exposed))
          await expose(tx, t.name, true, t.allowedColumns);
        await tx.exec('SET CONSTRAINTS ALL IMMEDIATE');
        await tx
          .query('INSERT INTO _qb_migrations VALUES(?,?,?,?,?)')
          .run(id, checksum, author, sql, new Date().toISOString());
        await this.stampSchema();
        return { id, schemaVersion: await schemaVersion(tx) };
      })
      .immediate();
  }
  safeSQL(sql: string) {
    safeSQL(sql);
  }
  async snapshot(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    await this.db.snapshot(path);
    return { path, schemaVersion: await schemaVersion(this.db) };
  }
  async latest() {
    return Number(
      (
        (await this.db
          .query(
            'SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS seq FROM _qb_outbox_seq_seq',
          )
          .get()) as any
      )?.seq ?? 0,
    );
  }
  async events(after: number, identity: Identity, tableName?: string, through?: number) {
    await this.assertSchema();
    const latest = await this.latest();
    through ??= latest;
    const floor = Number(
      ((await this.db.query("SELECT value FROM _qb_meta WHERE key='outbox_floor'").get()) as any)
        ?.value ?? 0,
    );
    if (after < floor || after > latest)
      throw new QBError('RESYNC_REQUIRED', 'Replay window expired; fetch a fresh snapshot', 409);
    const rows = (await this.db
      .query(
        `SELECT seq,table_name,operation,schema_version,
        CASE WHEN octet_length(old_json)>65536 THEN NULL ELSE old_json END AS old_json,
        CASE WHEN octet_length(new_json)>65536 THEN NULL ELSE new_json END AS new_json,
        CASE WHEN octet_length(pk_json)>65536 THEN NULL ELSE pk_json END AS pk_json,
        (COALESCE(octet_length(old_json),0)>65536 OR COALESCE(octet_length(new_json),0)>65536 OR octet_length(pk_json)>65536) AS oversized
        FROM _qb_outbox WHERE seq>? AND seq<=? ORDER BY seq LIMIT 200`,
      )
      .all(after, through)) as any[];
    const events = [];
    for (const row of rows) {
      if (tableName && row.table_name !== tableName) continue;
      const table = (await schema(this.db)).find((t) => t.name === row.table_name && t.exposed);
      if (!table) continue;
      if (row.oversized)
        throw new QBError(
          'RESYNC_REQUIRED',
          'Event exceeds the replay limit; fetch a fresh snapshot',
          409,
        );
      const decode = (value: string | null) => {
        if (!value) return null;
        const image = JSON.parse(value);
        for (const column of table.columns)
          if (
            column.type.toUpperCase() === 'BYTEA' &&
            typeof image[column.name] === 'string' &&
            image[column.name].startsWith('qb_bytes:')
          )
            image[column.name] = Buffer.from(image[column.name].slice(9), 'hex');
        return image;
      };
      const old = decode(row.old_json);
      const next = decode(row.new_json);
      const oldAllowed = old && (await this.visible(table, old, identity));
      const nextAllowed = next && (await this.visible(table, next, identity));
      if (nextAllowed)
        events.push({
          eventId: String(row.seq),
          type: 'database',
          table: table.name,
          event: row.operation,
          payload: normalize(Object.fromEntries(table.allowedColumns.map((n) => [n, next[n]]))),
          schemaVersion: Number(row.schema_version),
        });
      else if (oldAllowed)
        events.push({
          eventId: String(row.seq),
          type: 'database',
          table: table.name,
          event: 'delete',
          payload: normalize(decode(row.pk_json)),
          schemaVersion: Number(row.schema_version),
        });
    }
    return { events, cursor: rows.length ? Number(rows.at(-1).seq) : latest };
  }
  async rpc(name: string, args: Record<string, unknown>, identity: Identity, idempotency?: string) {
    const row = (await this.db
      .query('SELECT definition FROM _qb_rpc WHERE name=?')
      .get(name)) as any;
    if (!row) throw new QBError('NOT_FOUND', 'Operation not available', 404);
    const operation = JSON.parse(row.definition);
    if (
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).some((key) => !(key in operation.args)) ||
      Object.entries(operation.args).some(([key, type]) => typeof args[key] !== type)
    )
      throw new QBError('VALIDATION', 'RPC arguments do not match declaration');
    const values = Object.fromEntries(
      Object.entries(operation.values ?? {}).map(([key, value]: [string, any]) => [
        key,
        value && typeof value === 'object'
          ? 'arg' in value
            ? args[value.arg]
            : 'claim' in value
              ? identity.sub
              : null
          : value,
      ]),
    );
    return operation.kind === 'query'
      ? await this.read(operation.table, operation.query ?? {}, identity)
      : await this.mutate(
          operation.table,
          operation.kind,
          values,
          identity,
          operation.keyArg ? String(args[operation.keyArg]) : undefined,
          idempotency,
        );
  }
  async types() {
    return generateTypes(
      await schema(this.db),
      await schemaVersion(this.db),
      ((await this.db.query('SELECT definition FROM _qb_rpc').all()) as any[]).map((r) =>
        JSON.parse(r.definition),
      ),
    );
  }
}
