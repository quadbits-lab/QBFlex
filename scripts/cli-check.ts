import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from '../tests/helpers';
const f = await fixture(),
  directory = mkdtempSync(join(tmpdir(), 'qb-cli-'));
try {
  const project = await f.project('cli-quickstart');
  const token = (await f.call('/management/v1/tokens', 'POST', { projects: [project.id] }, f.token))
    .data.token;
  async function command(...args: string[]) {
    const child = Bun.spawn([process.execPath, resolve('apps/cli/src/index.ts'), ...args], {
      cwd: directory,
      env: {
        ...process.env,
        QB_PUBLIC_URL: f.url,
        QB_MANAGEMENT_TOKEN: token,
        QB_CLI_TEST_SECRET: 'not-printed-cli-secret',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error('CLI ' + args[0] + ' failed: ' + error);
    if (out.includes(token) || out.includes('not-printed-cli-secret'))
      throw new Error('CLI exposed a credential');
    return JSON.parse(out);
  }
  await command('init');
  await command('link', '--project', project.id, '--branch', project.branchId, '--url', f.url);
  if ((await command('projects', 'list')).data[0].id !== project.id)
    throw new Error('Project list failed');
  writeFileSync(
    join(directory, '002.sql'),
    'CREATE TABLE notes(id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL);',
  );
  await command('db', 'migrate', '--file', '002.sql', '--id', '002');
  writeFileSync(
    join(directory, 'rows.json'),
    JSON.stringify([{ id: 'first', title: 'CLI imported task', owner_id: 'cli' }]),
  );
  await command('db', 'import', '--table', 'tasks', '--file', 'rows.json');
  await command('db', 'export', '--table', 'tasks', '--output', 'export.json');
  if (
    JSON.parse(readFileSync(join(directory, 'export.json'), 'utf8'))[0].title !==
    'CLI imported task'
  )
    throw new Error('Export differs');
  await command('types', 'generate');
  if (
    !readFileSync(join(directory, 'qb-flex.types.ts'), 'utf8').includes('export interface Database')
  )
    throw new Error('Generated types missing');
  const backup = await command('backup', 'create');
  const restored = await command('backup', 'restore', '--backup', backup.data.id);
  if (restored.data.status !== 'ready') throw new Error('CLI restore failed');
  if ((await command('branches', 'list')).data.length !== 2) throw new Error('Branch list failed');
  await command('secrets', 'set', '--name', 'CLI_TEST', '--env', 'QB_CLI_TEST_SECRET');
  console.log(
    'CLI init/link/list/migrate/import/export/types/backup/restore/secrets quickstart passed against the real API.',
  );
  project.client.dispose();
} finally {
  await f.close();
  rmSync(directory, { recursive: true, force: true });
}
