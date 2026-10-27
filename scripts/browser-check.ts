import { chromium, firefox, webkit, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
const browserName = process.env.QB_BROWSER_ENGINE ?? 'chromium';
const engine = { chromium, firefox, webkit }[browserName as 'chromium' | 'firefox' | 'webkit'];
if (!engine) throw new Error('QB_BROWSER_ENGINE must be chromium, firefox or webkit');
const browser = await engine.launch().catch(async (error) => {
  await f.close();
  throw error;
});
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
  const context = await browser.newContext(
    browserName === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {},
  );
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
  if (browserName === 'chromium')
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
  // Newly documented workflows must render directly, remain searchable and preserve mobile layout.
  for (const [slug, title] of [
    ['getting-started/updates', 'What changed in QB Flex'],
    ['authentication/passkeys-mfa', 'Passkeys and application MFA'],
    ['authentication/email', 'Resend and React Email'],
    ['studio/schema-visualizer', 'Schema Visualizer'],
    ['studio/job-inbox', 'Job Inbox'],
    ['studio/webhooks', 'Durable webhooks'],
    ['studio/security-advisor', 'Security Advisor'],
    ['self-hosting/doctor', 'Deployment Doctor'],
    ['roadmap/expanded-release', 'Expanded release specification 1.1'],
    ['roadmap/native-push', 'Native SDK and push requirements'],
    ['roadmap/wasm', 'Optional WASM tooling requirements'],
    ['reference/development-spec', 'Complete development specification'],
  ]) {
    await page.goto(`http://localhost:3031/docs/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await expect(page.locator('.docs-article')).toContainText('Specification version: 1.1');
  await expect(page.locator('.docs-article')).toContainText('Sections 31–37');
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search documentation', exact: true }).fill('Job Inbox');
  await expect(
    page
      .getByRole('dialog')
      .getByRole('link', { name: /Job Inbox/ })
      .first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('http://localhost:3031/docs/does-not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('isn’t here');
  const project = await f.project('browser-tutorial');
  const booleanSql = 'ALTER TABLE tasks ADD COLUMN enabled boolean NOT NULL DEFAULT false';
  const booleanReview = await f.call(
    project.base + '/reviews',
    'POST',
    { migrationId: 'native-boolean-editor', sql: booleanSql },
    f.token,
  );
  await f.call(
    project.base + '/reviews/' + booleanReview.data.id + '/rehearse',
    'POST',
    {},
    f.token,
  );
  await f.call(
    project.base + '/reviews/' + booleanReview.data.id + '/approve',
    'POST',
    {},
    f.token,
  );
  await f.call(project.base + '/migrations', 'POST', { reviewId: booleanReview.data.id }, f.token);
  await f.call(
    project.base + '/exposure/tasks',
    'PUT',
    { enabled: true, columns: ['id', 'owner_id', 'title', 'completed', 'revision', 'enabled'] },
    f.token,
  );
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
  await page.goto('http://localhost:3030/sign-in');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('owner-password-12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('Build your backend', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
  await sidebar.getByRole('link', { name: 'Database', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New table', exact: true })).toBeVisible();
  // Studio forms refresh the grid/count without manual reload; edits and deletion follow the same contract.
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  let rowDialog = page.getByRole('dialog', { name: 'Insert row', exact: true });
  await rowDialog.locator('#row-enabled').fill('true');
  await rowDialog.getByLabel(/^owner_id/).fill('studio-refresh-owner');
  await rowDialog.getByLabel(/^title/).fill('Created without reload');
  await rowDialog.getByRole('button', { name: 'Save row', exact: true }).click();
  await expect(rowDialog).toHaveCount(0);
  await expect(page.getByText('Created without reload', { exact: true })).toBeVisible();
  await expect(page.getByText(/1 rows on this page/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit row', exact: true }).click();
  rowDialog = page.getByRole('dialog', { name: 'Edit row', exact: true });
  await rowDialog.getByLabel(/^title/).fill('Edited without reload');
  await rowDialog.getByRole('button', { name: 'Save row', exact: true }).click();
  await expect(page.getByText('Edited without reload', { exact: true })).toBeVisible();
  await expect(page.getByText('Created without reload', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete row', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete row', exact: true })
    .getByRole('button', { name: 'Delete row', exact: true })
    .click();
  await expect(page.getByText('Edited without reload', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/0 rows on this page/)).toBeVisible();
  // Schema visualizer: canvas nodes + details sheet
  await sidebar.getByRole('link', { name: 'Schema', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schema Visualizer', exact: true })).toBeVisible();
  const tableNode = page.locator('.react-flow [role="group"]', { hasText: 'tasks' }).first();
  await tableNode.click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('Private table')
      .or(page.getByText('Exposed through REST'))
      .first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await sidebar.getByRole('link', { name: 'Storage', exact: true }).click();
  await page.getByRole('combobox', { name: 'Storage bucket' }).click();
  await page.getByRole('option', { name: 'attachments', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Storage bucket' })).toContainText('attachments');
  await expect(page.getByText('No objects in this bucket', { exact: true })).toBeVisible();
  await page.getByLabel('Choose file to upload', { exact: true }).setInputFiles({
    name: 'studio-refresh.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Isolated Studio refresh test'),
  });
  await expect(
    page.getByRole('table').getByText('studio-refresh.txt', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Actions for studio-refresh.txt', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Delete object', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Delete object', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
  await expect(
    page.getByRole('button', { name: 'Actions for studio-refresh.txt', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('table').getByText('studio-refresh.txt', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Actions for studio-refresh.txt', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete object', exact: true })
    .getByRole('button', { name: 'Delete object', exact: true })
    .click();
  await expect(
    page.getByRole('table').getByText('studio-refresh.txt', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('No objects in this bucket', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
  await expect(
    page.getByRole('textbox', { name: 'Search for files and folders', exact: true }),
  ).toBeFocused();
  // Owner-foundation Inbox: actual server state, no external delivery or payload capture.
  const jobOwner = f.service.owners.get(project.branchId)!;
  const deadJob = await jobOwner.call('jobs-submit', {
    kind: 'webhook.delivery',
    eventId: 'browser-event',
    deduplicationKey: 'browser-inbox',
    payload: { private: 'payload-canary-must-not-render' },
  });
  const jobClaim = await jobOwner.call('jobs-claim', { kinds: ['webhook.delivery'] });
  await jobOwner.call('jobs-finish', {
    id: deadJob.id,
    leaseToken: jobClaim.leaseToken,
    result: { success: false, code: 'TEST_FAILURE' },
    kinds: ['webhook.delivery'],
  });
  await sidebar.getByRole('link', { name: 'Job Inbox', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job Inbox', exact: true })).toBeVisible();
  await expect(page.getByText('webhook.delivery', { exact: true })).toBeVisible();
  await expect(page.getByText('payload-canary-must-not-render', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Replay dead-letter job?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: /View job details for/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Job attempt history' })).toBeVisible();
  await page.keyboard.press('Escape');
  await sidebar.getByRole('link', { name: 'Security', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Security Advisor', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ADMIN MFA GAP', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Acknowledge finding?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Clear acknowledgment', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear acknowledgment', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear acknowledgment', exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: join(artifacts, 'studio-security-' + browserName + '.png'),
    fullPage: true,
  });
  const integrationKey = (
    await f.call(
      `/management/v1/projects/${project.id}/keys`,
      'POST',
      {
        scope: 'service',
        branch: project.branchId,
        tables: ['tasks'],
        methods: ['GET'],
      },
      f.token,
    )
  ).data;
  await sidebar.getByRole('link', { name: 'Webhooks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New webhook', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Task receiver');
  await page.getByLabel('HTTPS destination').fill('https://receiver.example/events');
  await page.getByRole('combobox', { name: 'Integration service key' }).click();
  await page.getByRole('option', { name: new RegExp(integrationKey.key.slice(0, 15)) }).click();
  await page.getByLabel('Allowed columns (comma-separated)').fill('id, title');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Create subscription', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save your signing secret' })).toBeVisible();
  await page.getByRole('button', { name: 'I saved it', exact: true }).click();
  await expect(page.getByLabel('Signing secret', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Task receiver', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rotate secret', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save your signing secret' })).toBeVisible();
  await page.getByRole('button', { name: 'I saved it', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('revoked', { exact: true })).toBeVisible();
  // WebKit can paint the closing dialog during its fade. Audit the settled UI, not an animation frame.
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({
    path: join(artifacts, 'studio-webhooks-' + browserName + '.png'),
    fullPage: true,
  });
  // Mobile shell + drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle mobile navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Studio navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Studio navigation' })).toHaveCount(0);
  // Responsive metric grid on mobile
  await page.goto('http://localhost:3030/overview');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
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
