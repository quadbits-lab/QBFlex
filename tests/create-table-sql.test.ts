import { describe, expect, test } from 'bun:test';
import { Database } from '@qb-flex/database';
import {
  buildCreateTableSQL,
  formatDefault,
  isSafeIdent,
  quoteIdent,
  validateCreateTableDefinition,
  type ColumnDraft,
  type CreateTableDefinition,
  type ForeignKeyDraft,
} from '../apps/studio/src/workspaces/create-table-sql';
const col = (partial: Partial<ColumnDraft> & Pick<ColumnDraft, 'name'>): ColumnDraft => ({
  id: partial.id ?? partial.name,
  type: partial.type ?? 'TEXT',
  defaultValue: partial.defaultValue ?? 'NULL',
  nullable: partial.nullable ?? true,
  primary: partial.primary ?? false,
  name: partial.name,
});
const def = (
  partial: Partial<CreateTableDefinition> & Pick<CreateTableDefinition, 'name' | 'columns'>,
): CreateTableDefinition => ({
  description: partial.description ?? '',
  foreignKeys: partial.foreignKeys ?? [],
  name: partial.name,
  columns: partial.columns,
});
describe('create-table-sql', () => {
  test('accepts safe identifiers and quotes unsafe ones', () => {
    expect(isSafeIdent('tasks')).toBe(true);
    expect(isSafeIdent('1bad')).toBe(false);
    expect(quoteIdent('tasks')).toBe('tasks');
    expect(quoteIdent('order')).toBe('order');
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
  });
  test('omits NULL defaults and wraps expression defaults', () => {
    expect(formatDefault('NULL')).toBeNull();
    expect(formatDefault('')).toBeNull();
    expect(formatDefault('0')).toBe('0');
    expect(formatDefault("'active'")).toBe("'active'");
    expect(formatDefault('CURRENT_TIMESTAMP')).toBe('(CURRENT_TIMESTAMP)');
    expect(formatDefault('(CURRENT_TIMESTAMP)')).toBe('(CURRENT_TIMESTAMP)');
    expect(formatDefault('(gen_random_uuid()::text)')).toBe('(gen_random_uuid()::text)');
  });
  test('builds CREATE TABLE with description, PK, boolean check, and FK', () => {
    const sql = buildCreateTableSQL(
      def({
        name: 'tasks',
        description: 'User tasks',
        columns: [
          col({
            name: 'id',
            type: 'TEXT',
            nullable: false,
            primary: true,
            defaultValue: '(gen_random_uuid()::text)',
          }),
          col({
            name: 'done',
            type: 'BOOLEAN',
            nullable: false,
            defaultValue: '0',
          }),
          col({
            name: 'created_at',
            type: 'TIMESTAMPTZ',
            nullable: false,
            defaultValue: 'CURRENT_TIMESTAMP',
          }),
          col({ name: 'project_id', type: 'TEXT', nullable: false, defaultValue: 'NULL' }),
        ],
        foreignKeys: [
          {
            id: 'fk1',
            localColumn: 'project_id',
            referencedTable: 'projects',
            referencedColumn: 'id',
          } satisfies ForeignKeyDraft,
        ],
      }),
    );
    expect(sql).toContain('-- User tasks');
    expect(sql).toContain('CREATE TABLE tasks (');
    expect(sql).toContain('id TEXT NOT NULL DEFAULT (gen_random_uuid()::text)');
    expect(sql).toContain('done BOOLEAN NOT NULL DEFAULT (false)');
    expect(sql).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP)');
    expect(sql).toContain('project_id TEXT NOT NULL');
    expect(sql).toContain('PRIMARY KEY (id)');
    expect(sql).toContain('FOREIGN KEY (project_id) REFERENCES projects(id)');
    expect(sql.trim().endsWith(');')).toBe(true);
  });
  test('generated default SQL executes in PGlite', async () => {
    const sql = buildCreateTableSQL(
      def({
        name: 'demo_table',
        description: 'smoke',
        columns: [
          col({
            name: 'id',
            type: 'TEXT',
            nullable: false,
            primary: true,
            defaultValue: '(gen_random_uuid()::text)',
          }),
          col({
            name: 'created_at',
            type: 'TIMESTAMPTZ',
            nullable: false,
            defaultValue: 'CURRENT_TIMESTAMP',
          }),
        ],
      }),
    );
    const db = new Database(':memory:');
    await expect((async () => await db.exec(sql))()).resolves.toBeDefined();
  });
  test('validates required fields and references', () => {
    const existing = [
      {
        name: 'projects',
        columns: [{ name: 'id' }, { name: 'title' }],
      },
    ];
    expect(
      validateCreateTableDefinition(
        def({
          name: '',
          columns: [col({ name: 'id', primary: true })],
        }),
        existing,
      ),
    ).toContain('Table name is required.');
    expect(
      validateCreateTableDefinition(
        def({
          name: 'projects',
          columns: [col({ name: 'id', primary: true })],
        }),
        existing,
      ),
    ).toContain('Table "projects" already exists.');
    expect(
      validateCreateTableDefinition(
        def({
          name: 'tasks',
          columns: [col({ name: 'title' })],
        }),
        existing,
      ),
    ).toContain('Select at least one primary key column.');
    expect(
      validateCreateTableDefinition(
        def({
          name: 'tasks',
          columns: [col({ name: 'id', primary: true })],
          foreignKeys: [
            {
              id: 'fk1',
              localColumn: 'project_id',
              referencedTable: 'projects',
              referencedColumn: 'id',
            },
          ],
        }),
        existing,
      ),
    ).toContain('Foreign key column "project_id" is not defined on this table.');
    expect(
      validateCreateTableDefinition(
        def({
          name: 'tasks',
          columns: [col({ name: 'id', primary: true }), col({ name: 'project_id' })],
          foreignKeys: [
            {
              id: 'fk1',
              localColumn: 'project_id',
              referencedTable: 'projects',
              referencedColumn: 'missing',
            },
          ],
        }),
        existing,
      ),
    ).toContain('Referenced column "missing" was not found on "projects".');
    expect(
      validateCreateTableDefinition(
        def({
          name: 'tasks',
          columns: [col({ name: 'id', primary: true }), col({ name: 'project_id' })],
          foreignKeys: [
            {
              id: 'fk1',
              localColumn: 'project_id',
              referencedTable: 'projects',
              referencedColumn: 'id',
            },
          ],
        }),
        existing,
      ),
    ).toEqual([]);
  });
});
