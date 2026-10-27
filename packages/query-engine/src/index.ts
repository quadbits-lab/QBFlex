import { createHmac, timingSafeEqual } from 'node:crypto';
import { QBError, type Query, type Identity, type TableSchema, type AggregateExpr, type HavingClause } from '@qb-flex/contracts';
import { identifier, type Compiled } from '@qb-flex/policies';
export const normalize = (value: unknown): unknown =>
  typeof value === 'bigint'
    ? value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)
      ? String(value)
      : Number(value)
    : value instanceof Date
      ? value.toISOString()
      : value instanceof Uint8Array
        ? Buffer.from(value).toString('base64')
        : Array.isArray(value)
          ? value.map(normalize)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]))
            : value;
export const sqlValue = (value: unknown) => {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    throw new QBError('VALIDATION', 'Only scalar values are accepted');
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new QBError('VALIDATION', 'Invalid number');
  return typeof value === 'boolean' ? Number(value) : value;
};
/** Bind the wire representation using the declared PostgreSQL column type. */
export function columnValue(column: TableSchema['columns'][number], value: unknown): unknown {
  const scalar = sqlValue(value),
    kind = column.type.toUpperCase();
  if (scalar === null) return null;
  if (column.enum?.length) return scalar;
  if (/INT/.test(kind)) {
    if (typeof scalar === 'number' && Number.isSafeInteger(scalar)) return scalar;
    if (typeof scalar === 'string' && /^-?\d+$/.test(scalar)) {
      const integer = BigInt(scalar);
      if (integer >= -9223372036854775808n && integer <= 9223372036854775807n) return integer;
    }
    throw new QBError(
      'VALIDATION',
      'Integer columns require a safe integer or signed 64-bit decimal string',
    );
  }
  if (kind === 'BYTEA') {
    if (typeof scalar === 'string') {
      const bytes = Buffer.from(scalar, 'base64');
      if (bytes.toString('base64') === scalar) return bytes;
    }
    throw new QBError('VALIDATION', 'BYTEA columns require canonical base64 strings');
  }
  if (/BOOL/.test(kind)) {
    if (scalar === 0 || scalar === 1) return Boolean(scalar);
    throw new QBError('VALIDATION', 'Boolean columns require 0 or 1');
  }
  if (/REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL/.test(kind)) {
    if (typeof scalar === 'number' && Number.isFinite(scalar)) return scalar;
    if (typeof scalar === 'string' && scalar.trim() !== '' && Number.isFinite(Number(scalar)))
      return scalar;
    throw new QBError('VALIDATION', 'Numeric columns require a finite numeric value');
  }
  if (/^JSONB?$/.test(kind)) {
    try {
      if (typeof scalar !== 'string') throw new Error();
      JSON.parse(scalar);
      return scalar;
    } catch {
      throw new QBError('VALIDATION', 'JSON columns require valid JSON text');
    }
  }
  return scalar;
}
function isNumericKind(type: string): boolean {
  const kind = type.toUpperCase();
  return /INT|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL/.test(kind);
}

function validateAggregateExpr(
  table: TableSchema,
  agg: AggregateExpr,
  available: string[],
  seenAliases: Set<string>,
) {
  if (!identifier(agg.alias)) throw new QBError('VALIDATION', 'Invalid aggregate alias');
  if (seenAliases.has(agg.alias)) throw new QBError('VALIDATION', 'Duplicate aggregate alias');
  seenAliases.add(agg.alias);
  if (agg.fn !== 'count' && agg.fn !== 'countDistinct' && !agg.column)
    throw new QBError('VALIDATION', `Aggregate ${agg.fn} requires a column`);
  if (agg.column && !available.includes(agg.column))
    throw new QBError('VALIDATION', `Unknown or hidden aggregate column: ${agg.column}`);
  if ((agg.fn === 'sum' || agg.fn === 'avg') && agg.column) {
    const col = table.columns.find((c) => c.name === agg.column);
    if (!col || !isNumericKind(col.type))
      throw new QBError('VALIDATION', `${agg.fn} requires a numeric column`);
  }
}

export function compileQuery(
  table: TableSchema,
  query: Query,
  policy: Compiled,
): Compiled & {
  limit: number;
  selected: string[];
  order: {
    column: string;
    direction: 'asc' | 'desc';
  }[];
  aggregates?: AggregateExpr[];
  groupBy?: string[];
  having?: HavingClause[];
} {
  if (!query || typeof query !== 'object') throw new QBError('VALIDATION', 'Invalid query');
  const available = table.allowedColumns;
  const selected = query.columns ?? available;
  if (!Array.isArray(selected) || !selected.length || selected.some((c) => !available.includes(c)))
    throw new QBError('VALIDATION', 'Unknown or hidden column');
  const pk = table.columns
    .filter((c) => c.primaryKey)
    .sort((a, b) => a.primaryKey - b.primaryKey)
    .map((c) => c.name);
  if (
    (query.order !== undefined && !Array.isArray(query.order)) ||
    (query.filters !== undefined && !Array.isArray(query.filters))
  )
    throw new QBError('VALIDATION', 'Order and filters must be arrays');
  const order = [...(query.order ?? [])];
  if (
    order.length > 10 ||
    order.some((o) => !o || !available.includes(o.column) || !['asc', 'desc'].includes(o.direction))
  )
    throw new QBError('VALIDATION', 'Invalid order');
  for (const column of pk)
    if (!order.some((o) => o.column === column)) order.push({ column, direction: 'asc' });
  const params = [...policy.params];
  const conditions = [`(${policy.sql})`];
  if ((query.filters?.length ?? 0) > 30) throw new QBError('VALIDATION', 'Too many filters');
  for (const f of query.filters ?? []) {
    if (!f || !available.includes(f.column))
      throw new QBError('VALIDATION', 'Unknown or hidden filter');
    const column = identifier(f.column);
    if (f.op === 'isNull') conditions.push(`${column} IS ${f.value === false ? 'NOT ' : ''}NULL`);
    else if (f.op === 'in') {
      if (!Array.isArray(f.value) || f.value.length > 100)
        throw new QBError('VALIDATION', 'Invalid membership filter');
      conditions.push(
        f.value.length ? `${column} IN (${f.value.map(() => '?').join(',')})` : 'FALSE',
      );
      params.push(
        ...f.value.map((value) =>
          columnValue(
            table.columns.find((column) => column.name === f.column)!,
            value,
          ),
        ),
      );
    } else {
      const ops: Record<string, string> = {
        eq: '=',
        ne: '!=',
        lt: '<',
        lte: '<=',
        gt: '>',
        gte: '>=',
        like: 'LIKE',
      };
      if (!ops[f.op]) throw new QBError('VALIDATION', 'Invalid filter');
      if (f.value === null && ['eq', 'ne'].includes(f.op))
        conditions.push(`${column} IS ${f.op === 'ne' ? 'NOT ' : ''}NULL`);
      else {
        conditions.push(`${column} ${ops[f.op]} ?`);
        params.push(
          f.op === 'like'
            ? sqlValue(f.value)
            : columnValue(
                table.columns.find((column) => column.name === f.column)!,
                f.value,
              ),
        );
      }
    }
  }

  const hasAggregates = Array.isArray(query.aggregates) && query.aggregates.length > 0;
  if (hasAggregates) {
    if ((query.groupBy?.length ?? 0) > 5) throw new QBError('VALIDATION', 'Too many groupBy columns (max 5)');
    if ((query.aggregates?.length ?? 0) > 8) throw new QBError('VALIDATION', 'Too many aggregates (max 8)');
    if ((query.having?.length ?? 0) > 10) throw new QBError('VALIDATION', 'Too many having clauses (max 10)');
    if (query.cursor) throw new QBError('VALIDATION', 'Cursor pagination not supported with aggregates');
    if (query.relations) throw new QBError('VALIDATION', 'Relations not supported with aggregates');
    if (query.order && query.order.length > 0)
      throw new QBError('VALIDATION', 'Order not supported with aggregates; use groupBy columns');

    const groupBy = query.groupBy ?? [];
    for (const col of groupBy) {
      if (!available.includes(col)) throw new QBError('VALIDATION', `Unknown or hidden groupBy column: ${col}`);
    }

    const aggregates = query.aggregates!;
    const having = query.having ?? [];

    const seenAliases = new Set<string>();
    for (const agg of aggregates) {
      validateAggregateExpr(table, agg, available, seenAliases);
    }

    const aggregateAliases = new Set(aggregates.map((a) => a.alias));
    for (const h of having) {
      if (!aggregateAliases.has(h.alias))
        throw new QBError('VALIDATION', `Having alias ${h.alias} must match an aggregate alias`);
    }

    // Build aggregate SELECT expressions
    const aggSelect = aggregates.map((agg) => {
      const col = agg.column ? identifier(agg.column) : null;
      switch (agg.fn) {
        case 'count':
          return `COUNT(*) AS ${identifier(agg.alias)}`;
        case 'countDistinct':
          return col ? `COUNT(DISTINCT ${col}) AS ${identifier(agg.alias)}` : `COUNT(DISTINCT *) AS ${identifier(agg.alias)}`;
        case 'sum':
          return col ? `SUM(${col}) AS ${identifier(agg.alias)}` : `SUM(1) AS ${identifier(agg.alias)}`;
        case 'avg':
          return col ? `AVG(${col}) AS ${identifier(agg.alias)}` : `AVG(1) AS ${identifier(agg.alias)}`;
        case 'min':
          return col ? `MIN(${col}) AS ${identifier(agg.alias)}` : `MIN(1) AS ${identifier(agg.alias)}`;
        case 'max':
          return col ? `MAX(${col}) AS ${identifier(agg.alias)}` : `MAX(1) AS ${identifier(agg.alias)}`;
      }
    });

    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw new QBError('VALIDATION', 'Limit must be 1–500');

    const innerSelect = `${groupBy.map(identifier).join(',')}${groupBy.length && aggSelect.length ? ',' : ''}${aggSelect.join(',')}`;
    let innerSql = `SELECT ${innerSelect} FROM ${identifier(table.name)} AS "qb_row_0" WHERE ${conditions.join(' AND ')}`;
    if (groupBy.length) innerSql += ` GROUP BY ${groupBy.map(identifier).join(',')}`;

    let sql: string;
    if (having.length) {
      const havingConds = having.map((h) => {
        const ops: Record<string, string> = { eq: '=', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' };
        return `${identifier(h.alias)} ${ops[h.op]} ?`;
      });
      // Wrap in a subquery so aggregate aliases are unambiguous in the HAVING clause.
      sql = `SELECT * FROM (${innerSql}) AS "qb_having" WHERE ${havingConds.join(' AND ')}`;
      params.push(...having.map((h) => sqlValue(h.value)));
    } else {
      sql = innerSql;
    }
    sql += ` LIMIT ?`;
    params.push(limit);

    return {
      sql,
      params,
      limit,
      selected: [...groupBy, ...aggregates.map((a) => a.alias)],
      order: [],
      aggregates,
      groupBy,
      having,
    };
  }

  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new QBError('VALIDATION', 'Limit must be 1–500');
  return {
    sql: `SELECT ${[...new Set([...selected, ...order.map((o) => o.column)])].map(identifier).join(',')} FROM ${identifier(table.name)} AS "qb_row_0" WHERE ${conditions.join(' AND ')}`,
    params,
    limit,
    selected,
    order,
  };
}
export function cursorCodec(secret: string) {
  const sign = (value: string) => createHmac('sha256', secret).update(value).digest('base64url');
  return {
    encode(value: unknown) {
      const body = Buffer.from(JSON.stringify(value)).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    decode(value: string) {
      if (value.length > 8192) throw new QBError('INVALID_CURSOR', 'Invalid cursor');
      const [body, sig] = value.split('.');
      const expected = Buffer.from(sign(body ?? ''));
      const actual = Buffer.from(sig ?? '');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw new QBError('INVALID_CURSOR', 'Invalid cursor');
      try {
        return JSON.parse(Buffer.from(body!, 'base64url').toString());
      } catch {
        throw new QBError('INVALID_CURSOR', 'Invalid cursor');
      }
    },
    scope(table: string, query: Query, identity: Identity, version: number) {
      return sign(
        JSON.stringify({
          engine: 'pglite-v1',
          table,
          query: { ...query, cursor: undefined },
          identity,
          version,
        }),
      );
    },
  };
}
