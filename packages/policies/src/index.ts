import {
  QBError,
  type Expression,
  type Identity,
  type Operand,
  type Policy,
  type Operation,
} from '@qb-flex/contracts';
export const identifier = (name: string) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || name.startsWith('_qb_'))
    throw new QBError('INVALID_IDENTIFIER', 'Unsupported identifier');
  return `"${name}"`;
};
export interface Compiled {
  sql: string;
  params: unknown[];
}
type PolicyScalar = string | number | boolean | null;
/** Policy constants have scalar semantics independent of PostgreSQL parameter inference. */
function compareConstants(left: PolicyScalar, right: PolicyScalar): number | null {
  if (left === null || right === null) return null;
  const a = typeof left === 'boolean' ? Number(left) : left;
  const b = typeof right === 'boolean' ? Number(right) : right;
  if (typeof a !== typeof b) return typeof a === 'number' ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const x = new TextEncoder().encode(String(a)),
    y = new TextEncoder().encode(String(b));
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return x.length < y.length ? -1 : x.length > y.length ? 1 : 0;
}
export function compileExpression(
  expression: Expression,
  columns: string[],
  identity: Identity,
  depth = 0,
  options: {
    alias?: string;
    columnTypes?: Record<string, string>;
    exists?: (expression: Extract<Expression, { op: 'exists' }>) => Compiled;
  } = {},
): Compiled {
  if (depth > 12 || !expression || typeof expression !== 'object')
    throw new QBError('INVALID_POLICY', 'Invalid or excessively nested expression');
  const params: unknown[] = [];
  function constant(value: Operand): { known: true; value: PolicyScalar } | { known: false } {
    if (!value || typeof value !== 'object') throw new QBError('INVALID_POLICY', 'Invalid operand');
    if ('column' in value) return { known: false };
    if ('claim' in value) {
      if (!['sub', 'role'].includes(value.claim))
        throw new QBError('INVALID_POLICY', 'Unsupported claim');
      return { known: true, value: identity[value.claim] };
    }
    if (
      'value' in value &&
      (value.value === null || ['string', 'number', 'boolean'].includes(typeof value.value))
    ) {
      if (typeof value.value === 'number' && !Number.isFinite(value.value))
        throw new QBError('INVALID_POLICY', 'Invalid numeric policy value');
      return { known: true, value: value.value };
    }
    throw new QBError('INVALID_POLICY', 'Invalid operand');
  }
  function typedValue(value: unknown, other?: Operand) {
    const type = other && 'column' in other ? options.columnTypes?.[other.column] : undefined;
    if (type && /^(?:boolean|bool)$/i.test(type)) {
      if (value === null || typeof value === 'boolean') return value;
      if (value === 0 || value === 1) return Boolean(value);
      throw new QBError('INVALID_POLICY', 'Boolean policy values require 0/1 or true/false');
    }
    return typeof value === 'boolean' ? Number(value) : value;
  }
  function operand(value: Operand, other?: Operand): string {
    if (!value || typeof value !== 'object') throw new QBError('INVALID_POLICY', 'Invalid operand');
    if ('column' in value) {
      if (!columns.includes(value.column)) throw new QBError('INVALID_POLICY', 'Unknown column');
      return (options.alias ? `"${options.alias}".` : '') + identifier(value.column);
    }
    if ('claim' in value) {
      if (!['sub', 'role'].includes(value.claim))
        throw new QBError('INVALID_POLICY', 'Unsupported claim');
      params.push(identity[value.claim]);
      return '?';
    }
    if (
      'value' in value &&
      (value.value === null || ['string', 'boolean', 'number'].includes(typeof value.value))
    ) {
      params.push(typedValue(value.value, other));
      return '?';
    }
    throw new QBError('INVALID_POLICY', 'Invalid operand');
  }
  let sql: string;
  if (expression.op === 'exists') {
    if (!options.exists) throw new QBError('INVALID_POLICY', 'Relationship is not approved');
    return options.exists(expression);
  }
  if (expression.op === 'true' || expression.op === 'false')
    sql = expression.op === 'true' ? 'TRUE' : 'FALSE';
  else if ('args' in expression && ['and', 'or'].includes(expression.op)) {
    if (
      !Array.isArray(expression.args) ||
      expression.args.length < 1 ||
      expression.args.length > 30
    )
      throw new QBError('INVALID_POLICY', 'Expected 1–30 expressions');
    sql =
      '(' +
      expression.args
        .map((arg) => {
          const c = compileExpression(arg, columns, identity, depth + 1, options);
          params.push(...c.params);
          return c.sql;
        })
        .join(expression.op === 'and' ? ' AND ' : ' OR ') +
      ')';
  } else if (expression.op === 'not') {
    const c = compileExpression(expression.arg, columns, identity, depth + 1, options);
    params.push(...c.params);
    sql = `(NOT (${c.sql}))`;
  } else if (expression.op === 'isNull') {
    const known = constant(expression.arg);
    sql = known.known
      ? known.value === null
        ? 'TRUE'
        : 'FALSE'
      : `(${operand(expression.arg)} IS NULL)`;
  } else if (expression.op === 'in') {
    if (
      !Array.isArray(expression.values) ||
      expression.values.length > 100 ||
      expression.values.some(
        (v) =>
          (typeof v === 'number' && !Number.isFinite(v)) ||
          (v !== null && !['string', 'number', 'boolean'].includes(typeof v)),
      )
    )
      throw new QBError('INVALID_POLICY', 'Invalid membership values');
    const known = constant(expression.left);
    if (known.known) {
      const comparisons = expression.values.map((v) => compareConstants(known.value, v));
      return {
        sql: comparisons.some((v) => v === 0)
          ? 'TRUE'
          : comparisons.some((v) => v === null)
            ? 'NULL::boolean'
            : 'FALSE',
        params: [],
      };
    }
    const left = operand(expression.left);
    sql = expression.values.length
      ? `(${left} IN (${expression.values
          .map((v) => {
            params.push(typedValue(v, expression.left));
            return '?';
          })
          .join(',')}))`
      : 'FALSE';
  } else if ('left' in expression && 'right' in expression) {
    const operators: Record<string, string> = {
      eq: '=',
      ne: '!=',
      lt: '<',
      lte: '<=',
      gt: '>',
      gte: '>=',
    };
    if (!operators[expression.op]) throw new QBError('INVALID_POLICY', 'Unsupported operator');
    const left = constant(expression.left),
      right = constant(expression.right);
    if (left.known && right.known) {
      const compared = compareConstants(left.value, right.value);
      if (compared === null) return { sql: 'NULL::boolean', params: [] };
      const permitted =
        expression.op === 'eq'
          ? compared === 0
          : expression.op === 'ne'
            ? compared !== 0
            : expression.op === 'lt'
              ? compared < 0
              : expression.op === 'lte'
                ? compared <= 0
                : expression.op === 'gt'
                  ? compared > 0
                  : compared >= 0;
      return { sql: permitted ? 'TRUE' : 'FALSE', params: [] };
    }
    sql = `(${operand(expression.left, expression.right)} ${operators[expression.op]} ${operand(expression.right, expression.left)})`;
  } else throw new QBError('INVALID_POLICY', 'Unsupported operator');
  return { sql, params };
}
export function compilePolicies(
  policies: Policy[],
  table: string,
  operation: Operation,
  columns: string[],
  identity: Identity,
  phase: 'using' | 'check' = 'using',
  options: Parameters<typeof compileExpression>[4] = {},
): Compiled {
  const appRoles = identity.roles ?? [];
  const matching = policies.filter(
    (p) =>
      p.enabled &&
      p.resource === table &&
      p.operation === operation &&
      p.roles.some((r) => r === identity.role || appRoles.includes(r)),
  );
  const grants = matching.filter((p) => p.mode === 'permissive');
  if (!grants.length) return { sql: 'FALSE', params: [] };
  const restrictions = matching.filter((p) => p.mode === 'restrictive');
  const params: unknown[] = [];
  const compile = (p: Policy) => {
    const c = compileExpression(p[phase], columns, identity, 0, options);
    params.push(...c.params);
    return `(${c.sql})`;
  };
  return {
    sql: `(${grants.map(compile).join(' OR ')})${restrictions.length ? ' AND ' + restrictions.map(compile).join(' AND ') : ''}`,
    params,
  };
}
