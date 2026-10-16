import { QBError } from '@qb-flex/contracts';

/** Inspect SQL tokens without treating literal values or comments as executable SQL. */
function inspectSQL(sql: string) {
  let code = '';
  const identifiers: string[] = [];
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2);
      i = end < 0 ? sql.length : end;
      code += ' ';
    } else if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      code += ' ';
    } else if (sql[i] === '"') {
      let name = '';
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            name += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else name += sql[i++];
      }
      identifiers.push(name);
      code += ' identifier ';
    } else if (
      sql[i] === "'" ||
      (/[eE]/.test(sql[i]!) && sql[i + 1] === "'" && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? ' '))
    ) {
      const escaped = sql[i] !== "'";
      i += escaped ? 2 : 1;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') i += 2;
        else if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      code += ' literal ';
    } else if (sql[i] === '$' && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i))) {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))![0];
      const end = sql.indexOf(delimiter, i + delimiter.length);
      i = end < 0 ? sql.length : end + delimiter.length;
      code += ' literal ';
    } else code += sql[i++];
  }
  return { code, identifiers };
}

export function hasNumberedParameters(sql: string): boolean {
  return /\$[1-9][0-9]*\b/.test(inspectSQL(sql).code);
}

export function safeSQL(sql: string) {
  if (typeof sql !== 'string') throw new QBError('VALIDATION', 'SQL requires a string');
  const { code, identifiers } = inspectSQL(sql);
  const objects = [code, ...identifiers].join(' ');
  if (
    /_qb_|\bpg_(?!input_is_valid\b)[a-z0-9_]+\b|\binformation_schema\b|\b(?:query|table|cursor|schema|database)_to_xml[a-z_]*\b|\b(?:set_config|load_extension|lo_import|lo_export|dblink)\b/i.test(
      objects,
    )
  )
    throw new QBError(
      'UNSAFE_SQL',
      'SQL cannot access reserved objects or system execution facilities',
    );
  if (
    /(?:^|;)\s*(?:attach|detach|pragma|vacuum|begin|commit|rollback|savepoint|release|start\s+transaction|end|abort|set|reset|grant|revoke|copy|do|call|load|listen|notify|unlisten|discard|prepare|execute|deallocate)\b|\balter\s+(?:system|role|user|database)\b|\bcreate\s+(?:or\s+replace\s+)?(?:extension|function|procedure|role|user|database|schema)\b|\bU&/i.test(
      code,
    )
  )
    throw new QBError(
      'UNSAFE_SQL',
      'SQL cannot change transactions, roles or runtime configuration',
    );
}
