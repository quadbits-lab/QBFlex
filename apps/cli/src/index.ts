#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ManagementClient } from '@qb-flex/management-client';
import { QBError } from '@qb-flex/contracts';
import {
  restoreControlSnapshot,
  writeControlSnapshot,
} from '../../../packages/database/src/control-backup';
import { openDatabase } from '@qb-flex/database';
import { acquireLease } from '../../../packages/database/src/lease';
const program = new Command().name('qb').description('QB Flex project tools').version('0.1.0');
const linked = () => (existsSync('qb.json') ? JSON.parse(readFileSync('qb.json', 'utf8')) : {});
function token(url: string) {
  if (process.env.QB_MANAGEMENT_TOKEN) return process.env.QB_MANAGEMENT_TOKEN;
  if (process.platform === 'darwin') {
    const result = Bun.spawnSync(
      ['security', 'find-generic-password', '-a', url, '-s', 'qb-flex-cli', '-w'],
      { stderr: 'ignore' },
    );
    if (!result.exitCode) return result.stdout.toString().trim();
  }
  throw new QBError('LOGIN_REQUIRED', 'Run qb login or set QB_MANAGEMENT_TOKEN', 401);
}
function client(options: any = {}) {
  const url = options.url ?? process.env.QB_PUBLIC_URL ?? linked().url ?? 'http://localhost:7612';
  return new ManagementClient(url, token(url));
}
function target(options: any) {
  const config = linked();
  const project = options.project ?? config.project;
  const branch = options.branch ?? config.branch ?? 'primary';
  if (!project) throw new QBError('PROJECT_REQUIRED', 'Use --project or qb link');
  return { project, branch, base: `/projects/${project}/branches/${branch}` };
}
function output(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
function hiddenPassword(): Promise<string> {
  if (process.env.QB_PASSWORD) return Promise.resolve(process.env.QB_PASSWORD);
  if (!process.stdin.isTTY)
    throw new QBError('PASSWORD_REQUIRED', 'Use an interactive terminal or QB_PASSWORD');
  process.stdout.write('Password: ');
  return new Promise((resolve) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const input = (data: Buffer) => {
      for (const ch of data.toString()) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', input);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', input);
  });
}
function scoped(command: Command) {
  return command
    .option('--project <id>', 'Project ID')
    .option('--branch <id>', 'Branch ID or alias')
    .option('--url <url>', 'API URL');
}
program
  .command('init')
  .description('Create local project configuration')
  .action(() => {
    if (existsSync('qb.json')) throw new QBError('CONFIG_EXISTS', 'qb.json already exists');
    writeFileSync(
      'qb.json',
      JSON.stringify({ url: 'http://localhost:7612', branch: 'primary' }, null, 2) + '\n',
    );
    output({ created: 'qb.json' });
  });
program
  .command('dev')
  .description('Start the local workspace')
  .action(async () => {
    await import('../../../scripts/dev');
  });
program
  .command('login')
  .option('--url <url>', 'API URL', 'http://localhost:7612')
  .requiredOption('--email <email>', 'Platform email')
  .option('--organization <id>', 'Grant project lifecycle access within this organization')
  .action(async (options) => {
    const password = await hiddenPassword();
    const response = await fetch(options.url + '/platform/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: options.email, password }),
    });
    const session = await response.json();
    if (!response.ok)
      throw new QBError('LOGIN_FAILED', session.message ?? 'Sign in failed', response.status);
    if (session.twoFactorRedirect)
      throw new QBError(
        'MFA_REQUIRED',
        'Use a Studio-issued management token after completing MFA',
      );
    const management = new ManagementClient(
      options.url,
      response.headers.get('set-auth-token') ?? session.token,
    );
    if (process.platform !== 'darwin')
      throw new QBError(
        'KEYCHAIN_UNAVAILABLE',
        'Set QB_MANAGEMENT_TOKEN from a Studio-issued token on this host',
      );
    const result = await management.request('/tokens', 'POST', {
      organizations: options.organization ? [options.organization] : [],
    });
    const saved = Bun.spawnSync(
      [
        'security',
        'add-generic-password',
        '-U',
        '-a',
        options.url,
        '-s',
        'qb-flex-cli',
        '-w',
        result.data.token,
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    if (saved.exitCode)
      throw new QBError('KEYCHAIN_UNAVAILABLE', 'Could not save the credential to the OS keychain');
    output({ signedIn: true, url: options.url });
  });
scoped(program.command('link').description('Link a project and branch')).action((options) => {
  const { project, branch } = target(options);
  writeFileSync(
    'qb.json',
    JSON.stringify({ url: options.url ?? 'http://localhost:7612', project, branch }, null, 2) +
      '\n',
  );
  output({ project, branch });
});
const projects = program.command('projects');
projects
  .command('list')
  .option('--url <url>')
  .action(async (options) => output(await client(options).request('/projects')));
projects
  .command('create')
  .requiredOption('--organization <id>')
  .requiredOption('--name <name>')
  .requiredOption('--slug <slug>')
  .option('--url <url>')
  .action(async (options) =>
    output(
      await client(options).request('/projects', 'POST', {
        organizationId: options.organization,
        name: options.name,
        slug: options.slug,
        region: 'local',
      }),
    ),
  );
const db = program.command('db');
scoped(db.command('migrate').requiredOption('--file <file>').requiredOption('--id <id>')).action(
  async (options) =>
    output(
      await client(options).request(target(options).base + '/migrations', 'POST', {
        id: options.id,
        sql: readFileSync(options.file, 'utf8'),
      }),
    ),
);
scoped(
  db.command('diff').requiredOption('--file <file>', 'Expected schema JSON exported from /schema'),
).action(async (options) => {
  const expected = JSON.parse(readFileSync(options.file, 'utf8'));
  const actual = (await client(options).request(target(options).base + '/schema')).data;
  const tables = new Map(actual.tables.map((t: any) => [t.name, t]));
  const changes = [];
  for (const t of expected.tables ?? expected) {
    const current: any = tables.get(t.name);
    if (!current) changes.push({ table: t.name, change: 'missing' });
    else if (JSON.stringify(t.columns) !== JSON.stringify(current.columns))
      changes.push({
        table: t.name,
        change: 'columns differ',
        expected: t.columns,
        actual: current.columns,
      });
    tables.delete(t.name);
  }
  for (const name of tables.keys()) changes.push({ table: name, change: 'extra' });
  output({ changes });
});
scoped(
  db
    .command('reset')
    .requiredOption('--data-dir <path>', 'Local disposable data directory')
    .option('--confirm-local-reset', 'Confirm destruction of the local directory'),
).action((options) => {
  if (!options.confirmLocalReset)
    throw new QBError(
      'CONFIRM_REQUIRED',
      'Reset removes local SQLite databases and generated local keys; pass --confirm-local-reset',
    );
  const directory = resolve(options.dataDir);
  if (
    directory === process.cwd() ||
    directory === '/' ||
    !existsSync(join(directory, 'master.key')) ||
    !existsSync(join(directory, 'control.sqlite'))
  )
    throw new QBError(
      'DENIED',
      'Reset requires a QB Flex local data directory with generated master.key; stop its API first',
    );
  if (existsSync(join(directory, 'owner.lock')))
    throw new QBError('DENIED', 'Stop the local API before resetting its data directory');
  if (options.project || options.url)
    throw new QBError('DENIED', 'Local reset does not accept remote project or URL options');
  rmSync(directory, { recursive: true });
  output({ reset: directory });
});
scoped(
  db.command('export').requiredOption('--table <name>').requiredOption('--output <file>'),
).action(async (options) => {
  let cursor: string | undefined;
  const rows: unknown[] = [];
  do {
    const result = await client(options).request<any[]>(
      target(options).base +
        '/data/' +
        encodeURIComponent(options.table) +
        '?limit=500' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    rows.push(...result.data);
    cursor = result.meta.cursor;
  } while (cursor);
  writeFileSync(options.output, JSON.stringify(rows, null, 2) + '\n');
  output({ file: options.output, rows: rows.length });
});
scoped(
  db.command('import').requiredOption('--table <name>').requiredOption('--file <file>'),
).action(async (options) => {
  const rows = JSON.parse(readFileSync(options.file, 'utf8'));
  if (!Array.isArray(rows)) throw new QBError('VALIDATION', 'Import requires a JSON row array');
  for (let i = 0; i < rows.length; i += 100)
    await client(options).request(
      target(options).base + '/data/' + encodeURIComponent(options.table),
      'POST',
      rows.slice(i, i + 100),
    );
  output({ imported: rows.length });
});
const types = program.command('types');
scoped(
  types.command('generate').option('--output <file>', 'Output filename', 'qb-flex.types.ts'),
).action(async (options) => {
  writeFileSync(options.output, await client(options).text(target(options).base + '/types'));
  output({ file: options.output });
});
const backups = program.command('backup');
function localMaster(directory: string) {
  const value =
    process.env.QB_MASTER_KEY ?? readFileSync(join(directory, 'master.key'), 'utf8').trim();
  if (value.length < 32) throw new QBError('CONFIG', 'Provide the original protected master key');
  return value;
}
backups
  .command('control-create')
  .requiredOption('--data-dir <directory>', 'Stopped local API data directory')
  .action((options) => {
    const directory = resolve(options.dataDir),
      release = acquireLease(directory);
    try {
      const db = openDatabase(join(directory, 'control.sqlite'), false);
      try {
        output(writeControlSnapshot(db, directory, localMaster(directory)));
      } finally {
        db.close(true);
      }
    } finally {
      release();
    }
  });
backups
  .command('control-restore')
  .requiredOption('--data-dir <directory>')
  .requiredOption('--file <archive>')
  .option(
    '--confirm-local-control-restore',
    'Replace the stopped control catalog and revoke credentials',
  )
  .action((options) => {
    if (!options.confirmLocalControlRestore)
      throw new QBError(
        'CONFIRM_REQUIRED',
        'Use --confirm-local-control-restore after validating the catalog and referenced database files',
      );
    const directory = resolve(options.dataDir);
    output(restoreControlSnapshot(directory, localMaster(directory), resolve(options.file)));
  });
scoped(backups.command('create')).action(async (options) =>
  output(await client(options).request(target(options).base + '/backups', 'POST', {})),
);
scoped(backups.command('restore').requiredOption('--backup <id>')).action(async (options) =>
  output(
    await client(options).request(
      `/projects/${target(options).project}/backups/${options.backup}/restore`,
      'POST',
      {},
    ),
  ),
);
const branches = program.command('branches');
scoped(branches.command('list')).action(async (options) =>
  output(await client(options).request(`/projects/${target(options).project}/branches`)),
);
const storage = program.command('storage');
scoped(storage.command('list')).action(async (options) =>
  output(await client(options).request(target(options).base + '/buckets')),
);
const secrets = program.command('secrets');
scoped(
  secrets
    .command('set')
    .requiredOption('--name <name>', 'Secret name')
    .requiredOption('--env <variable>', 'Environment variable containing its value'),
).action(async (options) => {
  const value = process.env[options.env];
  if (value === undefined)
    throw new QBError('SECRET_REQUIRED', 'The specified environment variable is unset');
  output(
    await client(options).request(
      `/projects/${target(options).project}/secrets/${options.name}`,
      'PUT',
      { value },
    ),
  );
});
scoped(
  storage.command('sync').requiredOption('--bucket <id>').requiredOption('--directory <path>'),
).action(async (options) => {
  const root = resolve(options.directory);
  if (!statSync(root).isDirectory()) throw new QBError('VALIDATION', 'Directory required');
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      entry.isDirectory() ? visit(path) : entry.isFile() && files.push(path);
    }
  };
  visit(root);
  const api = client(options),
    base = target(options).base;
  const existing = (await api.request<any[]>(base + '/buckets/' + options.bucket + '/objects'))
    .data;
  for (const path of files) {
    const key = relative(root, path).replaceAll('\\', '/');
    if (existing.some((o) => o.key === key)) continue;
    const file = Bun.file(path);
    const intent = await api.request(base + '/buckets/' + options.bucket + '/objects', 'POST', {
      key,
      size: file.size,
      mime: file.type,
    });
    await api.transfer(base + '/objects/' + intent.data.id + '/content', 'PUT', file);
  }
  output({
    scanned: files.length,
    mode: 'add missing; existing and remote-only objects preserved',
  });
});
try {
  await program.parseAsync();
} catch (error) {
  console.error(
    JSON.stringify({
      error: {
        code: error instanceof QBError ? error.code : 'COMMAND_FAILED',
        message: error instanceof Error ? error.message : 'Command failed',
      },
    }),
  );
  process.exitCode = 1;
}
