import {
  QBError,
  type Identity,
  type SearchCollectionInput,
  type SearchCollectionState,
  type SearchCollectionSummary,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
  type TableSchema,
} from '@qb-flex/contracts';
import { identifier } from '@qb-flex/policies';
import type { Database } from './connection';
import type { BranchEngine } from './engine';

const TEXT_TYPE = /^(?:text|character varying|varchar|character|char)(?:\(\d+\))?$/i;
const COLLECTION_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const SNIPPET_CHARS = 1000;

interface CollectionRow {
  id: string;
  name: string;
  table_name: string;
  columns: string;
  state: SearchCollectionState;
  error: string | null;
  created_at: number | bigint;
  updated_at: number | bigint;
}

function invalid(message: string): never {
  throw new QBError('VALIDATION', message);
}

function safeIndexId(id: string): string {
  const safe = id.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/.test(safe)) invalid('Invalid search collection');
  return safe;
}

function indexTable(id: string): string {
  return `_qb_search_index_${safeIndexId(id)}`;
}

function iso(value: number | bigint): string {
  return new Date(Number(value)).toISOString();
}

function documentExpression(columns: string[]): string {
  return columns.map((column) => `coalesce(${identifier(column)}::text, '')`).join(` || ' ' || `);
}

/** Permission-aware PostgreSQL full-text collections. Indexes stay private; reads apply SELECT policy. */
export class SearchCollections {
  constructor(
    private engine: BranchEngine,
    private clock = Date.now,
  ) {}

  async initialize() {
    await this.engine.db.exec(`CREATE TABLE IF NOT EXISTS _qb_search_collections(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      table_name TEXT NOT NULL,
      columns TEXT NOT NULL,
      state TEXT NOT NULL,
      error TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL);`);
    return this;
  }

  async list(): Promise<SearchCollectionSummary[]> {
    const rows = (await this.engine.db
      .query(
        'SELECT * FROM _qb_search_collections ORDER BY created_at DESC, id DESC LIMIT 100',
      )
      .all()) as CollectionRow[];
    return rows.map((row) => this.summary(row));
  }

  async create(input: SearchCollectionInput): Promise<SearchCollectionSummary> {
    const table = await this.validateInput(input);
    if (await this.engine.db.query('SELECT 1 FROM _qb_search_collections WHERE name=?').get(input.name))
      invalid('Search collection name already exists');
    const id = crypto.randomUUID();
    const now = this.clock();
    const columns = [...input.columns];
    await this.engine.db
      .query(
        `INSERT INTO _qb_search_collections(id,name,table_name,columns,state,error,created_at,updated_at)
         VALUES(?,?,?,?,'building',NULL,?,?)`,
      )
      .run(id, input.name, table.name, JSON.stringify(columns), now, now);
    try {
      await this.rebuildStored(id);
    } catch (error) {
      await this.markFailed(id, error);
      throw error;
    }
    return this.summary(await this.row(id));
  }

  async rebuild(id: string): Promise<SearchCollectionSummary> {
    await this.row(id);
    try {
      await this.engine.db
        .query(`UPDATE _qb_search_collections SET state='rebuilding', error=NULL, updated_at=? WHERE id=?`)
        .run(this.clock(), id);
      await this.rebuildStored(id);
    } catch (error) {
      await this.markFailed(id, error);
      throw error;
    }
    return this.summary(await this.row(id));
  }

  async delete(id: string): Promise<void> {
    const row = await this.row(id);
    const index = indexTable(row.id);
    await this.engine.db
      .transaction(async (tx) => {
        await tx.exec(`DROP TABLE IF EXISTS ${index}`);
        await tx.query('DELETE FROM _qb_search_collections WHERE id=?').run(row.id);
      })
      .immediate();
  }

  async invalidateForSchemaChange(): Promise<void> {
    await this.engine.db
      .query(
        `UPDATE _qb_search_collections SET state='invalidated', updated_at=? WHERE state='ready'`,
      )
      .run(this.clock());
  }

  async search(engine: BranchEngine, identity: Identity, query: SearchQuery): Promise<SearchResult> {
    if (
      !identity ||
      !['anonymous', 'authenticated', 'service'].includes(identity.role) ||
      (identity.sub !== null && (typeof identity.sub !== 'string' || identity.sub.length > 200))
    )
      invalid('Invalid search identity');
    if (!query || typeof query.collection !== 'string' || !query.collection || query.collection.length > 80)
      invalid('Invalid search collection');
    if (typeof query.q !== 'string' || query.q.length > MAX_QUERY_LENGTH || !query.q.trim())
      invalid('Search query must be 1–200 characters');
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      invalid('Search limit must be 1–50');
    const row = await this.rowByCollection(query.collection);
    this.assertReady(row.state);
    await engine.refresh();
    const table = engine.table(row.table_name);
    const indexed = this.parseColumns(row.columns);
    if (
      indexed.some((column) => !table.allowedColumns.includes(column)) ||
      indexed.some((column) => !TEXT_TYPE.test(table.columns.find((item) => item.name === column)?.type ?? ''))
    )
      throw new QBError('SEARCH_UNAVAILABLE', 'Search collection is invalidated', 409);
    const primaryKey = this.primaryKey(table);
    const policy = engine.policy(table, 'select', identity);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const index = indexTable(row.id);
    const projected = table.allowedColumns.length
      ? `json_build_object(${table.allowedColumns
          .map((column) => `'${identifier(column).slice(1, -1)}', "qb_row_0".${identifier(column)}`)
          .join(',')})`
      : `'{}'::json`;
    const cursorSql = cursor
      ? `AND (ts_rank(i.document, plainto_tsquery('simple', ?)) < ?::real
          OR (ts_rank(i.document, plainto_tsquery('simple', ?)) = ?::real AND i.row_id > ?))`
      : '';
    const sql = `SELECT i.row_id AS qb_hit_id,
      ts_rank(i.document, plainto_tsquery('simple', ?)) AS qb_hit_rank,
      ts_headline('simple', coalesce(i.snippet, ''), plainto_tsquery('simple', ?),
        'MaxWords=20, MinWords=1, ShortWord=1') AS qb_hit_snippet,
      ${projected} AS qb_hit_row
      FROM ${identifier(table.name)} AS "qb_row_0"
      JOIN ${index} i ON i.row_id = "qb_row_0".${identifier(primaryKey)}::text
      WHERE i.document @@ plainto_tsquery('simple', ?)
        AND (${policy.sql})
        ${cursorSql}
      ORDER BY qb_hit_rank DESC, i.row_id ASC
      LIMIT ?`;
    const params: unknown[] = [query.q, query.q, query.q, ...policy.params];
    if (cursor) params.push(query.q, cursor.rank, query.q, cursor.rank, cursor.id);
    params.push(limit + 1);
    const countRow = (await this.engine.db
      .query(
        `SELECT count(*) AS n
         FROM ${identifier(table.name)} AS "qb_row_0"
         JOIN ${index} i ON i.row_id = "qb_row_0".${identifier(primaryKey)}::text
         WHERE i.document @@ plainto_tsquery('simple', ?)
           AND (${policy.sql})`,
      )
      .get(query.q, ...(policy.params as unknown[]))) as { n: number | bigint | string };
    const fetched = (await this.engine.db.query(sql).all(...(params as unknown[]))) as Record<
      string,
      unknown
    >[];
    const page = fetched.slice(0, limit);
    const hits = page.map((hit) => this.hit(table, hit));
    const last = page.at(-1);
    return {
      hits,
      count: Number(countRow.n),
      cursor:
        fetched.length > limit && last
          ? Buffer.from(
              JSON.stringify({ rank: String(last.qb_hit_rank), id: String(last.qb_hit_id) }),
            ).toString('base64url')
          : null,
    };
  }

  private async validateInput(input: SearchCollectionInput): Promise<TableSchema> {
    if (!input || typeof input.name !== 'string' || !COLLECTION_NAME.test(input.name))
      invalid('Invalid search collection name');
    if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 16)
      invalid('Search collection requires 1–16 columns');
    if (input.columns.some((column) => typeof column !== 'string') || new Set(input.columns).size !== input.columns.length)
      invalid('Search columns must be unique');
    await this.engine.refresh();
    const table = this.engine.table(input.table);
    for (const column of input.columns) {
      if (!table.allowedColumns.includes(column)) invalid('Search columns must be exposed');
      const defined = table.columns.find((item) => item.name === column);
      if (!defined || !TEXT_TYPE.test(defined.type)) invalid('Search columns must be text');
    }
    this.primaryKey(table);
    return table;
  }

  private async rebuildStored(id: string) {
    const row = await this.row(id);
    await this.engine.db
      .transaction(async (tx) => {
        await this.populate(tx, row);
        await tx
          .query(`UPDATE _qb_search_collections SET state='ready', error=NULL, updated_at=? WHERE id=?`)
          .run(this.clock(), id);
      })
      .immediate();
  }

  private async populate(tx: Database, row: CollectionRow) {
    await this.engine.refresh();
    const table = this.engine.table(row.table_name);
    const columns = this.parseColumns(row.columns);
    const primaryKey = this.primaryKey(table);
    const index = indexTable(row.id);
    const document = documentExpression(columns);
    await tx.exec(`CREATE TABLE IF NOT EXISTS ${index}(
      row_id TEXT PRIMARY KEY,
      document tsvector,
      snippet TEXT);`);
    await tx.exec(`TRUNCATE ${index}`);
    await tx.exec(`INSERT INTO ${index}(row_id, document, snippet)
      SELECT ${identifier(primaryKey)}::text,
        to_tsvector('simple', ${document}),
        left(${document}, ${SNIPPET_CHARS})
      FROM ${identifier(table.name)}`);
    await tx.exec(`CREATE INDEX IF NOT EXISTS ${index}_document ON ${index} USING GIN (document)`);
  }

  private async markFailed(id: string, error: unknown) {
    const message = error instanceof QBError ? error.message.slice(0, 300) : 'Search index build failed';
    await this.engine.db
      .query(`UPDATE _qb_search_collections SET state='failed', error=?, updated_at=? WHERE id=?`)
      .run(message, this.clock(), id);
  }

  private async row(id: string): Promise<CollectionRow> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) invalid('Invalid search collection');
    const row = (await this.engine.db
      .query('SELECT * FROM _qb_search_collections WHERE id=?')
      .get(id)) as CollectionRow | null;
    if (!row) throw new QBError('NOT_FOUND', 'Search collection not available', 404);
    return row;
  }

  private async rowByCollection(collection: string): Promise<CollectionRow> {
    const row = (await this.engine.db
      .query(
        'SELECT * FROM _qb_search_collections WHERE id=? OR name=? ORDER BY (id=?) DESC LIMIT 1',
      )
      .get(collection, collection, collection)) as CollectionRow | null;
    if (!row) throw new QBError('NOT_FOUND', 'Search collection not available', 404);
    return row;
  }

  private summary(row: CollectionRow): SearchCollectionSummary {
    return {
      id: row.id,
      name: row.name,
      table: row.table_name,
      columns: this.parseColumns(row.columns),
      state: row.state,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      error: row.error,
    };
  }

  private parseColumns(value: string): string[] {
    const columns = JSON.parse(value) as unknown;
    if (!Array.isArray(columns) || columns.some((column) => typeof column !== 'string'))
      invalid('Invalid search collection columns');
    return columns as string[];
  }

  private primaryKey(table: TableSchema): string {
    const keys = table.columns
      .filter((column) => column.primaryKey)
      .sort((left, right) => left.primaryKey - right.primaryKey);
    if (keys.length !== 1 || !keys[0]) invalid('Search requires a single-column primary key');
    return keys[0].name;
  }

  private assertReady(state: SearchCollectionState): void {
    switch (state) {
      case 'ready':
        return;
      case 'building':
      case 'rebuilding':
      case 'invalidated':
      case 'unsupported':
      case 'failed':
        throw new QBError('SEARCH_UNAVAILABLE', `Search collection is ${state}`, 409);
      default: {
        const unexpected: never = state;
        throw new QBError('SEARCH_UNAVAILABLE', `Search collection is ${unexpected}`, 409);
      }
    }
  }

  private decodeCursor(value: string): { rank: string; id: string } {
    if (typeof value !== 'string' || value.length > 512)
      throw new QBError('INVALID_CURSOR', 'Invalid cursor');
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as {
        rank?: unknown;
        id?: unknown;
      };
      if (
        typeof parsed.rank !== 'string' ||
        typeof parsed.id !== 'string' ||
        !parsed.id ||
        parsed.id.length > 200 ||
        !Number.isFinite(Number(parsed.rank))
      )
        throw new Error('invalid');
      return { rank: parsed.rank, id: parsed.id };
    } catch (error) {
      if (error instanceof QBError) throw error;
      throw new QBError('INVALID_CURSOR', 'Invalid cursor');
    }
  }

  private hit(table: TableSchema, record: Record<string, unknown>): SearchHit {
    const source = this.rowObject(record.qb_hit_row);
    const row: Record<string, unknown> = {};
    for (const column of table.allowedColumns) {
      if (Object.prototype.hasOwnProperty.call(source, column)) row[column] = source[column];
    }
    return {
      id: String(record.qb_hit_id),
      table: table.name,
      rank: Number(record.qb_hit_rank),
      snippet: record.qb_hit_snippet == null ? null : String(record.qb_hit_snippet),
      row,
    };
  }

  private rowObject(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    return {};
  }
}
