import { chromium, expect } from '@playwright/test';
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture } from '../tests/helpers';
const root = process.cwd(),
  artifacts = resolve('verification-artifacts');
mkdirSync(artifacts, { recursive: true });
const f = await fixture({
  studioURL: 'http://localhost:3030',
  origins: [
    'http://localhost:3030',
    'http://localhost:3031',
    'http://localhost:7617',
    'http://localhost:7618',
  ],
});
const processes: any[] = [];
const browser = await chromium.launch();
const errors: string[] = [];
let activePage: any;
const spawn = (app: string, args: string[], env: Record<string, string> = {}) => {
  const process = Bun.spawn(['bun', ...args], {
    cwd: resolve(app),
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  processes.push(process);
  return process;
};
async function ready(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`Server not ready: ${url}`);
}
try {
  spawn('apps/docs', ['server.ts'], { PORT: '3031' });
  spawn('apps/studio', ['run', 'dev', '--port', '3030'], {
    VITE_API_URL: f.url,
    VITE_DOCS_URL: 'http://localhost:3031',
  });
  spawn('examples/react', ['run', 'dev']);
  spawn('examples/vanilla', ['run', 'dev']);
  await Promise.all(
    [
      'http://localhost:3030',
      'http://localhost:3031',
      'http://localhost:7617',
      'http://localhost:7618',
    ].map(ready),
  );
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:3031/docs/sdk/react/quickstart');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('React quickstart');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'http://localhost:7611/docs/sdk/react/quickstart',
  );
  for (const href of await page
    .locator('.docs-toc a[href^="#"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')!))) {
    expect(await page.locator(href).count()).toBe(1);
  }
  await page.getByRole('button', { name: 'Copy code' }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('bun run');
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search documentation', exact: true }).fill('realtime');
  await expect(page.getByRole('dialog').getByRole('link').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('html')).toHaveClass('light');
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.screenshot({ path: join(artifacts, 'docs-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle documentation navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Documentation' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'docs-mobile.png'), fullPage: true });
  await page.goto('http://localhost:3031/docs/does-not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('isn’t here');
  const project = await f.project('browser-tutorial');
  const direct = await page.evaluate(
    async ({ url, id, key }) => {
      const modulePath = '/sdk/client.js';
      const module = await import(modulePath);
      const client = module.createClient({ url, projectId: id, publishableKey: key });
      const session = await client.auth.signUp({
        name: 'Direct ESM',
        email: 'browser-esm@example.com',
        password: 'application-password-12345',
      });
      const created = await client
        .from('tasks')
        .insert({ owner_id: session.user.id, title: 'Browser ESM' });
      const rows = await client.from('tasks').execute();
      await client.from('tasks').delete(created.data[0].id);
      await client.auth.signOut();
      client.dispose();
      return rows.data[0].title;
    },
    { url: f.url, id: project.id, key: project.key },
  );
  expect(direct).toBe('Browser ESM');
  const bucket = (
    await f.call(
      project.base + '/buckets',
      'POST',
      { name: 'attachments', visibility: 'private', maxSize: 1048576, mimeRules: [] },
      f.token,
    )
  ).data.id;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://localhost:3030');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('owner-password-12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project overview', exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'studio-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Studio navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Studio navigation' })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .locator('.studio-sidebar nav')
    .getByRole('button', { name: 'Database', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'New table', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schema', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'API exposure' })).toBeVisible();
  await page
    .locator('.studio-sidebar nav')
    .getByRole('button', { name: 'Storage', exact: true })
    .click();
  await page.getByRole('button', { name: /attachments/ }).click();
  await expect(page.getByRole('heading', { name: 'Objects', exact: true })).toBeVisible();
  for (const [kind, port] of [
    ['react', 7617],
    ['vanilla', 7618],
  ] as const) {
    const appContext = await browser.newContext();
    const app = await appContext.newPage();
    activePage = app;
    app.on('pageerror', (e) => errors.push(kind + ': ' + e.message));
    await app.goto(`http://localhost:${port}`);
    await app.getByLabel('API URL', { exact: true }).fill(f.url);
    await app.getByLabel('Project ID', { exact: true }).fill(project.id);
    await app.getByLabel('Publishable key', { exact: true }).fill(project.key);
    await app.getByRole('button', { name: 'Connect project', exact: true }).click();
    if (kind === 'react') await app.getByRole('button', { name: 'Register', exact: true }).click();
    await app
      .getByLabel(kind === 'react' ? 'Name' : 'Name (registration)', { exact: true })
      .fill(kind + ' User');
    await app.getByLabel('Email', { exact: true }).fill(kind + '@example.com');
    await app.getByLabel('Password', { exact: true }).fill('application-password-12345');
    await app
      .getByRole('button', { name: kind === 'react' ? 'Create account' : 'Register', exact: true })
      .click();
    await expect(app.getByRole('heading', { name: 'Your tasks' })).toBeVisible();
    await app.getByLabel('New task', { exact: true }).fill(kind + ' task');
    await app.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(app.getByText(kind + ' task', { exact: true })).toBeVisible();
    await app.getByRole('checkbox').first().click();
    await expect(app.getByRole('checkbox').first()).toBeChecked();
    await expect(app.getByText(kind + ' task', { exact: true })).toHaveClass('completed');
    await app.getByLabel('Bucket ID', { exact: true }).fill(bucket);
    await app.getByLabel('File', { exact: true }).setInputFiles({
      name: kind + '.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('browser bytes ' + kind),
    });
    await expect(
      app.getByRole('button', { name: 'Download attachment', exact: true }),
    ).toBeEnabled();
    const downloaded = app.waitForEvent('download');
    await app.getByRole('button', { name: 'Download attachment', exact: true }).click();
    const download = await downloaded;
    expect(await Bun.file((await download.path())!).text()).toBe('browser bytes ' + kind);
    await app.getByRole('button', { name: 'Delete attachment', exact: true }).click();
    if (kind === 'react')
      await expect(
        app.getByRole('button', { name: 'Download attachment', exact: true }),
      ).toHaveCount(0);
    else
      await expect(
        app.getByRole('button', { name: 'Download attachment', exact: true }),
      ).toBeDisabled();
    await app.screenshot({ path: join(artifacts, kind + '-example.png'), fullPage: true });
    await app
      .getByRole('button', {
        name: kind === 'react' ? 'Delete ' + kind + ' task' : 'Delete',
        exact: true,
      })
      .click();
    await expect(app.getByText(kind + ' task', { exact: true })).toHaveCount(0);
    await app.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(app.getByLabel('Password', { exact: true })).toBeVisible();
    await appContext.close();
  }
  project.client.dispose();
  expect(errors).toEqual([]);
  console.log(
    'Docs navigation/search/mobile/metadata and Studio/React/Vanilla CRUD/file workflows passed. Screenshots: verification-artifacts/',
  );
} catch (error) {
  console.error('Browser page errors:', errors);
  if (activePage) {
    await activePage.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true });
    console.error((await activePage.locator('body').innerText()).slice(0, 4000));
  }
  throw error;
} finally {
  await browser.close();
  for (const process of processes) process.kill();
  await Promise.allSettled(processes.map((process) => process.exited));
  await f.close();
}
