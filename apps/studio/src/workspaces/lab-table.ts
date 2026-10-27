/** Browser-local table lab. No network, no WASM worker, no persistence. */

export const LAB_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const LAB_MAX_RESULT_BYTES = 2 * 1024 * 1024;
export const LAB_QUERY_TIMEOUT_MS = 10_000;
const MAX_COLUMNS = 64;
const YIELD_EVERY = 2_000;

export type LabFilterOp = 'eq' | 'neq' | 'contains';

export type LabFilter = {
  column: string;
  op: LabFilterOp;
  value: string;
};

export type LabTable = {
  columns: string[];
  rows: Record<string, string>[];
};

export function labFormat(name: string): 'csv' | 'json' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

export async function parseLabFile(file: File, signal: AbortSignal): Promise<LabTable> {
  if (file.size > LAB_MAX_FILE_BYTES) throw new Error('File exceeds the 100 MB lab budget');
  const format = labFormat(file.name);
  if (!format) {
    throw new Error(
      'Use a CSV or JSON file. Parquet and SQLite need the DuckDB-WASM or SQLite WASM worker, which this lab does not load.',
    );
  }
  signal.throwIfAborted();
  const text = await file.text();
  signal.throwIfAborted();
  if (format === 'csv') return parseCsv(text, signal);
  return parseJson(text, signal);
}

export async function filterLabRows(
  table: LabTable,
  filter: LabFilter,
  signal: AbortSignal,
): Promise<{ rows: Record<string, string>[]; truncated: boolean; matched: number }> {
  if (!table.columns.includes(filter.column)) throw new Error('Choose a column from this file');
  const started = performance.now();
  const matched: Record<string, string>[] = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    if (index % YIELD_EVERY === 0) {
      signal.throwIfAborted();
      if (performance.now() - started > LAB_QUERY_TIMEOUT_MS) {
        throw new DOMException('Filter exceeded 10 seconds', 'TimeoutError');
      }
      await Promise.resolve();
    }
    const row = table.rows[index];
    if (row && matches(row[filter.column] ?? '', filter)) matched.push(row);
  }
  signal.throwIfAborted();
  const capped = capDisplay(matched);
  return { rows: capped.rows, truncated: capped.truncated, matched: matched.length };
}

export function draftCreateTable(columns: string[]): { migrationId: string; sql: string } {
  if (!columns.length) throw new Error('Import a file before exporting a review');
  const used = new Set<string>();
  const names = columns.map((column, index) => {
    let name = column.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1').slice(0, 60);
    if (!/^[A-Za-z_]/.test(name)) name = `col_${index + 1}`;
    const base = name;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base.slice(0, 56)}_${suffix}`;
      suffix += 1;
    }
    used.add(name);
    return `"${name.replaceAll('"', '')}"`;
  });
  const sql = `CREATE TABLE lab_import (\n${names.map((name) => `  ${name} text`).join(',\n')}\n);\n`;
  return { migrationId: `lab-${crypto.randomUUID()}`, sql };
}

export function capDisplay(rows: Record<string, string>[]): {
  rows: Record<string, string>[];
  truncated: boolean;
} {
  const kept: Record<string, string>[] = [];
  let bytes = 2;
  for (const row of rows) {
    const next = bytes + JSON.stringify(row).length + 1;
    if (next > LAB_MAX_RESULT_BYTES) return { rows: kept, truncated: true };
    kept.push(row);
    bytes = next;
  }
  return { rows: kept, truncated: false };
}

function matches(cell: string, filter: LabFilter) {
  if (filter.op === 'eq') return cell === filter.value;
  if (filter.op === 'neq') return cell !== filter.value;
  if (filter.op === 'contains') return cell.toLowerCase().includes(filter.value.toLowerCase());
  const unreachable: never = filter.op;
  return unreachable;
}

async function parseCsv(text: string, signal: AbortSignal): Promise<LabTable> {
  const grid = parseCsvGrid(text);
  if (!grid.length) throw new Error('CSV file has no rows');
  const header = grid[0] ?? [];
  if (!header.length || header.length > MAX_COLUMNS) {
    throw new Error(`CSV must have 1–${MAX_COLUMNS} columns`);
  }
  const columns = header.map((name, index) => name.trim() || `column_${index + 1}`);
  const rows: Record<string, string>[] = [];
  for (let index = 1; index < grid.length; index += 1) {
    if (index % YIELD_EVERY === 0) {
      signal.throwIfAborted();
      await Promise.resolve();
    }
    const cells = grid[index] ?? [];
    if (cells.every((cell) => cell === '')) continue;
    const row: Record<string, string> = {};
    for (let column = 0; column < columns.length; column += 1) {
      row[columns[column]!] = cells[column] ?? '';
    }
    rows.push(row);
  }
  return { columns, rows };
}

function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function parseJson(text: string, signal: AbortSignal): Promise<LabTable> {
  signal.throwIfAborted();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON could not be parsed');
  }
  const records = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (!records) throw new Error('JSON must be an array of objects or { rows: [...] }');
  const columns: string[] = [];
  const rows: Record<string, string>[] = [];
  for (let index = 0; index < records.length; index += 1) {
    if (index % YIELD_EVERY === 0) {
      signal.throwIfAborted();
      await Promise.resolve();
    }
    const record = records[index];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Row ${index + 1} is not an object`);
    }
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!columns.includes(key)) {
        if (columns.length >= MAX_COLUMNS) throw new Error(`JSON exceeds ${MAX_COLUMNS} columns`);
        columns.push(key);
      }
      row[key] = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    }
    rows.push(row);
  }
  if (!columns.length) throw new Error('JSON file has no columns');
  return { columns, rows };
}
