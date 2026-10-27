import {
  QBError,
  type Identity,
  type RowAccessIdentity,
  type RowAccessRequest,
  type RowAccessResult,
  type TableSchema,
} from '@qb-flex/contracts';
import { identifier } from '@qb-flex/policies';
import type { BranchEngine } from './engine';

const MAX_IDENTITIES = 10;

function identityOf(input: RowAccessIdentity): Identity {
  const roles = Array.isArray(input?.roles) ? input.roles : [];
  if (
    !input ||
    (input.role !== 'anonymous' && input.role !== 'authenticated') ||
    roles.length > 16 ||
    roles.some((role) => typeof role !== 'string' || role.length > 64) ||
    (input.sub !== null && (typeof input.sub !== 'string' || input.sub.length > 200)) ||
    (input.role === 'authenticated' && !input.sub) ||
    (input.role === 'anonymous' && (input.sub !== null || roles.length > 0))
  )
    throw new QBError('VALIDATION', 'Invalid row-access identity');
  return { sub: input.sub, role: input.role, roles };
}

/** Old-row USING check for update/delete. Insert is not a property of an existing row. */
async function usingPermits(
  engine: BranchEngine,
  table: TableSchema,
  operation: 'update' | 'delete',
  identity: Identity,
  row: Record<string, unknown>,
) {
  const policy = engine.policy(table, operation, identity);
  const names = table.columns.map((column) => column.name);
  const projection = names
    .map(
      (name) =>
        `?::${table.columns.find((column) => column.name === name)!.type} AS ${identifier(name)}`,
    )
    .join(',');
  const result = (await engine.db
    .query(
      `SELECT (${policy.sql}) AS permitted FROM (SELECT ${projection}) AS "qb_row_0"`,
    )
    .get(...([...policy.params, ...names.map((name) => row[name] ?? null)] as never[]))) as
    | { permitted?: unknown }
    | null;
  return !!result?.permitted;
}

/**
 * Privileged read of one primary-key row, then per-identity select/update/delete checks.
 * `insert` is null because this helper evaluates an existing row, not a prospective write.
 * `columns` is the exposed allowlist when select passes, otherwise empty.
 */
export async function evaluateRowAccess(
  engine: BranchEngine,
  input: RowAccessRequest,
): Promise<RowAccessResult[]> {
  if (!input || !Array.isArray(input.identities) || input.identities.length > MAX_IDENTITIES)
    throw new QBError('LIMIT_EXCEEDED', 'Row access accepts at most 10 identities');
  const identities = input.identities.map(identityOf);
  await engine.assertSchema();
  const table = engine.table(input.table);
  const key = engine.key(table, input.key);
  const row = (await engine.db
    .query(`SELECT * FROM ${identifier(table.name)} WHERE ${key.sql}`)
    .get(...(key.params as never[]))) as Record<string, unknown> | null;
  if (!row) throw new QBError('NOT_FOUND', 'Row not found', 404);
  const results: RowAccessResult[] = [];
  for (let index = 0; index < identities.length; index++) {
    const identity = identities[index]!;
    const select = await engine.visible(table, row, identity);
    results.push({
      identity: input.identities[index]!,
      select,
      insert: null,
      update: await usingPermits(engine, table, 'update', identity, row),
      delete: await usingPermits(engine, table, 'delete', identity, row),
      columns: select ? [...table.allowedColumns] : [],
    });
  }
  return results;
}
