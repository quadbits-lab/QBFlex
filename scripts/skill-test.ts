import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fixture } from '../tests/helpers';
import { publicSDKPackages, readSDKManifest, sdkTarballPath } from './sdk-packages';
const root = process.cwd(),
  directory = mkdtempSync(join(tmpdir(), 'qb-skill-detached-'));
const processes: ReturnType<typeof Bun.spawn>[] = [];
const transfer = process.env.QB_INTEGRATION_STORAGE === '1';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let service: Awaited<ReturnType<typeof fixture>> | undefined;
async function run(args: string[], cwd = root, env = process.env) {
  const p = Bun.spawn(args, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code) throw new Error(`${args.slice(0, 3).join(' ')} failed\n${out}\n${err}`);
  return out;
}
try {
  await run(['bun', 'scripts/skill.ts', 'check']);
  await run(['bun', 'scripts/skill.ts', 'pack']);
  // Use an independent standard ZIP extractor, not the package builder's own parser.
  await run(['unzip', '-q', resolve('dist/skills/qbflex-skills.zip'), '-d', directory]);
  const skill = join(directory, 'qbflex-skills');
  await run(['node', join(skill, 'scripts/check-package.mjs'), skill], directory);
  const before = createHash('sha256')
    .update(readFileSync(join(skill, 'MANIFEST.json')))
    .digest('hex');
  const probe = join(directory, 'application');
  mkdirSync(probe);
  writeFileSync(
    join(probe, 'package.json'),
    JSON.stringify({ name: 'detached-app', version: '1.0.0' }),
  );
  writeFileSync(
    join(probe, 'qb.json'),
    JSON.stringify({
      url: 'http://localhost:7612',
      project: 'PROJECT_ID',
      branch: 'BRANCH_ID',
      token: 'diagnostic-secret-must-not-print',
    }),
  );
  writeFileSync(join(probe, '.env'), 'QB_MASTER_KEY=diagnostic-secret-must-not-print');
  const diagnostic = await run(
    ['node', join(skill, 'scripts/diagnose.mjs'), '--directory', probe],
    directory,
    {
      ...process.env,
      QB_MASTER_KEY: 'diagnostic-secret-must-not-print',
      VITE_SERVICE_KEY: 'diagnostic-secret-must-not-print',
    },
  );
  expect(diagnostic).not.toContain('diagnostic-secret-must-not-print');
  expect(diagnostic).not.toContain(directory);
  expect(JSON.parse(diagnostic).browserUnsafe[0].status).toBe('unsafe-browser-credential-name');
  expect(JSON.parse(diagnostic).target.project).toBe('configured');
  expect(readdirSync(probe).sort()).toEqual(['.env', 'package.json', 'qb.json']);
  expect(
    createHash('sha256')
      .update(readFileSync(join(skill, 'MANIFEST.json')))
      .digest('hex'),
  ).toBe(before);
  // Test semantic validation as well as checksums by updating a tampered file's inventory hash.
  async function rejects(
    file: string,
    edit: (content: string) => string,
    rehash: boolean,
    generated = false,
  ) {
    const path = join(skill, file),
      original = readFileSync(path),
      manifestPath = join(skill, 'MANIFEST.json'),
      originalManifest = readFileSync(manifestPath);
    try {
      writeFileSync(path, edit(original.toString()));
      if (rehash) {
        const manifest = JSON.parse(originalManifest.toString());
        manifest.files[file] = createHash('sha256').update(readFileSync(path)).digest('hex');
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      }
      let rejected = false;
      try {
        await run(
          generated
            ? [
                'bun',
                join(skill, 'scripts/refresh.ts'),
                '--source-root',
                root,
                '--skill-dir',
                skill,
                '--check',
              ]
            : ['node', join(skill, 'scripts/check-package.mjs'), skill],
          directory,
        );
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      writeFileSync(path, original);
      writeFileSync(manifestPath, originalManifest);
    }
  }
  await rejects('SKILL.md', (text) => text + '\nTampered content.\n', false);
  await rejects(
    'SKILL.md',
    (text) => text.replace('name: qbflex-skills', 'name: wrong-name'),
    true,
  );
  await rejects(
    'agents/openai.yaml',
    (text) => text.replace('allow_implicit_invocation: true', 'allow_implicit_invocation: false'),
    true,
  );
  await rejects(
    'SKILL.md',
    (text) => text + '\n[Missing reference](references/missing.md)\n',
    true,
  );
  await rejects(
    'references/generated/api.md',
    (text) => text + '\nStale generated contract.\n',
    true,
    true,
  );
  await run(['bun', 'scripts/sdk-pack.ts']);
  const install = async (kind: string) => {
    const cwd = join(skill, 'assets/examples', kind);
    const [clientPackage, reactPackage] = publicSDKPackages;
    const [clientManifest, reactManifest] = await Promise.all([
      readSDKManifest(clientPackage),
      readSDKManifest(reactPackage),
    ]);
    const tarballs = [
      sdkTarballPath(clientPackage, clientManifest.version),
      ...(kind === 'react' ? [sdkTarballPath(reactPackage, reactManifest.version)] : []),
    ];
    await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], cwd);
    await run(['npm', 'run', 'typecheck'], cwd);
    await run(['npm', 'run', 'build'], cwd);
  };
  await Promise.all(['react', 'vanilla'].map(install));
  console.log(
    'Detached archive, metadata/checksums, redacted diagnostics, packed declarations and both application builds passed.',
  );
  const ports = { react: 17617, vanilla: 17618 };
  service = await fixture({ origins: Object.values(ports).map((p) => `http://localhost:${p}`) });
  const f = service;
  const prerequisites = JSON.parse(
    readFileSync(join(skill, 'assets/examples/prerequisites.json'), 'utf8'),
  );
  async function provision(kind: string) {
    const created = await f.call(
      '/management/v1/projects',
      'POST',
      {
        organizationId: f.organizations[0].id,
        name: 'Portable skill ' + kind,
        slug: 'portable-skill-' + kind,
      },
      f.token,
    );
    await f.service.tick();
    const project = {
      id: created.data.id,
      branch: created.data.branchId,
      base: `/management/v1/projects/${created.data.id}/branches/${created.data.branchId}`,
    };
    const schemaSql = readFileSync(join(skill, 'assets/examples/schema.sql'), 'utf8');
    const review = await f.call(
      project.base + '/reviews',
      'POST',
      { migrationId: prerequisites.migrationId, sql: schemaSql },
      f.token,
    );
    await f.call(project.base + '/reviews/' + review.data.id + '/rehearse', 'POST', {}, f.token);
    await f.call(project.base + '/reviews/' + review.data.id + '/approve', 'POST', {}, f.token);
    await f.call(project.base + '/migrations', 'POST', { reviewId: review.data.id }, f.token);
    await f.call(project.base + '/exposure/tasks', 'PUT', prerequisites.exposure, f.token);
    for (const policy of prerequisites.policies)
      await f.call(project.base + '/policies', 'PUT', policy, f.token);
    await f.call(project.base + '/rpc', 'PUT', prerequisites.rpc, f.token);
    const key = (await f.call(`/management/v1/projects/${project.id}/keys`, 'POST', {}, f.token))
      .data.key;
    const typesResponse = await f.response(project.base + '/types', 'GET', undefined, f.token);
    const liveTypes = await typesResponse.text();
    // Schema version may include policy changes; declarations must otherwise match the live API.
    const normalize = (s: string) => s.replace(/Schema version \d+/, 'Schema version VERSION');
    const ts = (await import('typescript')).default;
    const format = (s: string) =>
      ts
        .createPrinter()
        .printFile(ts.createSourceFile('types.ts', normalize(s), ts.ScriptTarget.Latest, true));
    expect(format(liveTypes)).toBe(
      format(readFileSync(join(skill, 'assets/examples/react/src/qb-flex.types.ts'), 'utf8')),
    );
    const bucket = transfer
      ? (await f.call(project.base + '/buckets', 'POST', prerequisites.bucket, f.token)).data.id
      : null;
    return { project, key, bucket };
  }
  for (const [kind, port] of Object.entries(ports)) {
    const child = Bun.spawn(['npm', 'run', 'dev', '--', '--port', String(port)], {
      cwd: join(skill, 'assets/examples', kind),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    processes.push(child);
  }
  for (const port of Object.values(ports)) {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(500) })).ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    if (!ready) throw new Error('Detached example server did not start');
  }
  browser = await chromium.launch();
  const pageErrors: string[] = [];
  for (const [kind, port] of Object.entries(ports)) {
    const { project, key, bucket } = await provision(kind);
    const context = await browser.newContext(),
      app = await context.newPage();
    await context.addInitScript(() => {
      const state = window as typeof window & {
        __qbTestSockets: WebSocket[];
      };
      state.__qbTestSockets = [];
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (String(url).includes('/realtime')) state.__qbTestSockets.push(this);
        }
      };
    });
    app.on('pageerror', (error) => pageErrors.push(error.message));
    await app.goto(`http://localhost:${port}`);
    await app.getByLabel('API URL', { exact: true }).fill(f.url);
    await app.getByLabel('Project ID', { exact: true }).fill(project.id);
    await app.getByLabel('Branch', { exact: true }).fill(project.branch);
    await app.getByLabel('Publishable key', { exact: true }).fill(key);
    await app.getByRole('button', { name: 'Connect project', exact: true }).click();
    if (kind === 'react') await app.getByRole('button', { name: 'Register', exact: true }).click();
    await app
      .getByLabel(kind === 'react' ? 'Name' : 'Name (registration)', { exact: true })
      .fill('Portable user');
    const email = `portable-${kind}@example.com`,
      password = 'portable-application-password-12345';
    await app.getByLabel('Email', { exact: true }).fill(email);
    await app.getByLabel('Password', { exact: true }).fill(password);
    await app
      .getByRole('button', { name: kind === 'react' ? 'Create account' : 'Register', exact: true })
      .click();
    await expect(app.getByRole('heading', { name: 'Your tasks' })).toBeVisible();
    await expect(app.getByText('Remote protected task', { exact: true })).toHaveCount(0);
    await app.getByLabel('New task', { exact: true }).fill(kind + ' portable task');
    await app.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(app.getByText(kind + ' portable task', { exact: true })).toBeVisible();
    await app.getByRole('checkbox').first().click();
    await expect(app.getByRole('checkbox').first()).toBeChecked();
    // Independent ESM client produces an event; on reconnect snapshot resynchronization preserves it.
    await expect(app.getByText('Realtime: connected', { exact: true })).toBeVisible();
    await app.evaluate(() => {
      const state = window as typeof window & {
        __qbTestSockets: WebSocket[];
      };
      state.__qbTestSockets.find((socket) => socket.readyState === WebSocket.OPEN)!.close();
    });
    await expect(app.getByText('Realtime: reconnecting', { exact: true })).toBeVisible();
    await expect(app.getByText('Realtime: connected', { exact: true })).toBeVisible();
    const remote = await app.evaluate(
      async ({ moduleURL, url, id, branch, key, email, password }) => {
        const module = await import(/* @vite-ignore */ moduleURL);
        const client = module.createClient({ url, projectId: id, branch, publishableKey: key });
        await client.auth.signIn({ email, password });
        const result = await client.rpc('create_task', { title: 'Remote protected task' });
        client.dispose();
        return result.data[0].id;
      },
      {
        moduleURL: `http://localhost:${ports.vanilla}/vendor/client.js`,
        url: f.url,
        id: project.id,
        branch: project.branch,
        key,
        email,
        password,
      },
    );
    expect(remote).toBeTruthy();
    await expect(app.getByText('Remote protected task', { exact: true })).toBeVisible();
    if (transfer) {
      await app.getByLabel('Bucket ID', { exact: true }).fill(bucket);
      await app.getByLabel('File', { exact: true }).setInputFiles({
        name: kind + '.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('portable bytes ' + kind),
      });
      await expect(
        app.getByRole('button', { name: 'Download attachment', exact: true }),
      ).toBeEnabled();
      const downloading = app.waitForEvent('download');
      await app.getByRole('button', { name: 'Download attachment', exact: true }).click();
      const download = await downloading;
      expect(readFileSync((await download.path())!, 'utf8')).toBe('portable bytes ' + kind);
      await app.getByRole('button', { name: 'Delete attachment', exact: true }).click();
    }
    await app
      .getByRole('listitem')
      .filter({ has: app.getByText(kind + ' portable task', { exact: true }) })
      .getByRole('button', {
        name: kind === 'react' ? 'Delete ' + kind + ' portable task' : 'Delete',
        exact: true,
      })
      .click();
    await expect(app.getByText(kind + ' portable task', { exact: true })).toHaveCount(0);
    await app.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(app.getByLabel('Password', { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        app.evaluate(() => {
          const state = window as typeof window & {
            __qbTestSockets: WebSocket[];
          };
          return state.__qbTestSockets.filter((socket) => socket.readyState === WebSocket.OPEN)
            .length;
        }),
      )
      .toBe(0);
    if (kind === 'react')
      await app.getByRole('button', { name: 'Use existing account', exact: true }).click();
    await app.getByLabel('Email', { exact: true }).fill(email);
    await app.getByLabel('Password', { exact: true }).fill(password);
    await app.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(app.getByText('Remote protected task', { exact: true })).toBeVisible();
    await context.close();
  }
  // The direct-module HTML imports without a bundler and cleans up on pagehide.
  const direct = await browser.newPage();
  await direct.goto(`http://localhost:${ports.vanilla}/direct/index.html`);
  await expect(direct.getByRole('button', { name: 'Connect project' })).toBeVisible();
  await direct.close();
  expect(pageErrors).toEqual([]);
  console.log(
    `Portable React/Vanilla auth, protected CRUD, reviewed RPC, realtime reconnect, cleanup and direct ESM passed. Private transfers: ${transfer ? 'passed' : 'SKIPPED (set QB_INTEGRATION_STORAGE=1 and configure local S3)'}.`,
  );
  await run(['bun', 'test', 'tests'], root);
  console.log(
    'Existing platform security, durability, restore and React lifecycle regression tests passed.',
  );
} finally {
  await browser?.close();
  for (const p of processes) p.kill();
  await Promise.allSettled(processes.map((p) => p.exited));
  await service?.close();
  rmSync(directory, { recursive: true, force: true });
}
