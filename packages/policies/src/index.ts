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
export function compileExpression(
  expression: Expression,
  columns: string[],
  identity: Identity,
  depth = 0,
  options: {
    alias?: string;
    exists?: (expression: Extract<Expression, { op: 'exists' }>) => Compiled;
  } = {},
): Compiled {
  if (depth > 12 || !expression || typeof expression !== 'object')
    throw new QBError('INVALID_POLICY', 'Invalid or excessively nested expression');
  const params: unknown[] = [];
  function operand(value: Operand): string {
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
      params.push(typeof value.value === 'boolean' ? Number(value.value) : value.value);
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
    sql = expression.op === 'true' ? '1' : '0';
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
  } else if (expression.op === 'isNull') sql = `(${operand(expression.arg)} IS NULL)`;
  else if (expression.op === 'in') {
    if (
      !Array.isArray(expression.values) ||
      expression.values.length > 100 ||
      expression.values.some(
        (v) => v !== null && !['string', 'number', 'boolean'].includes(typeof v),
      )
    )
      throw new QBError('INVALID_POLICY', 'Invalid membership values');
    const left = operand(expression.left);
    sql = expression.values.length
      ? `(${left} IN (${expression.values
          .map((v) => {
            params.push(typeof v === 'boolean' ? Number(v) : v);
            return '?';
          })
          .join(',')}))`
      : '0';
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
    sql = `(${operand(expression.left)} ${operators[expression.op]} ${operand(expression.right)})`;
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
  const matching = policies.filter(
    (p) =>
      p.enabled &&
      p.resource === table &&
      p.operation === operation &&
      p.roles.includes(identity.role),
  );
  const grants = matching.filter((p) => p.mode === 'permissive');
  if (!grants.length) return { sql: '0', params: [] };
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
