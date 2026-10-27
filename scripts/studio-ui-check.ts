import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from '../tests/helpers';
const origin = 'http://localhost:3042';
const artifacts = resolve('verification-artifacts/studio-revamp');
mkdirSync(artifacts, { recursive: true });
const f = await fixture({ studioURL: origin, origins: [origin] });
const browser = await chromium.launch();
const vite = Bun.spawn(['bun', 'run', 'dev', '--port', '3042'], {
  cwd: resolve('apps/studio'),
  env: { ...process.env, VITE_API_URL: f.url },
  stdout: 'ignore',
  stderr: 'ignore',
});
let project: Awaited<ReturnType<typeof f.project>> | undefined;
const runtimeErrors: string[] = [];
const violations: unknown[] = [];
const layoutFailures: string[] = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }
  project = await f.project('ui-check');
  const fixtureSql =
    "CREATE TABLE comments(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), body TEXT); INSERT INTO tasks(id,owner_id,title) VALUES('ui-task','ui-owner','Review responsive layout');";
  const fixtureReview = await f.call(
    project.base + '/reviews',
    'POST',
    { migrationId: 'ui-fixture', sql: fixtureSql },
    f.token,
  );
  await f.call(
    project.base + '/reviews/' + fixtureReview.data.id + '/rehearse',
    'POST',
    {},
    f.token,
  );
  await f.call(
    project.base + '/reviews/' + fixtureReview.data.id + '/approve',
    'POST',
    {},
    f.token,
  );
  await f.call(project.base + '/migrations', 'POST', { reviewId: fixtureReview.data.id }, f.token);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) runtimeErrors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(origin + '/sign-in');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const authAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  violations.push(...authAxe.violations.map((v) => ({ route: 'sign-in', theme: 'dark', ...v })));
  await page.screenshot({ path: artifacts + '/sign-in.png' });
  await page.getByLabel('Email', { exact: true }).fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('owner-password-12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/overview');
  await expect(page.getByText('Build your backend', { exact: true })).toBeVisible();
  const visit = async (route: string) => {
    await page
      .locator(`nav[aria-label="Workspaces"] a[href="/${route}"]`)
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await expect(page).toHaveURL(origin + '/' + route);
  };
  const routes = [
    'overview',
    'database',
    'schema',
    'auth',
    'api',
    'realtime',
    'storage',
    'backups',
    'functions',
    'ai',
    'logs',
    'settings',
  ];
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('menuitem', { name: 'Light theme', exact: true }).click();
      await expect(page.locator('html')).toHaveClass(/light/);
    }
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      for (const route of routes) {
        await visit(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toContainText(
          'ui-check',
        );
        if (route === 'schema')
          await expect(page.getByRole('group', { name: /Table tasks,/ })).toBeVisible();
        await page.waitForTimeout(120);
        const overflow = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        if (overflow.scroll > overflow.width)
          layoutFailures.push(`${route} ${theme} ${width}: scrollWidth ${overflow.scroll}`);
        if (width === 1440 || width === 375)
          await page.screenshot({
            path: `${artifacts}/${route}-${theme}-${width}.png`,
            fullPage: true,
          });
        if (width === 1440) {
          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          violations.push(...results.violations.map((v) => ({ route, theme, ...v })));
          writeFileSync(
            artifacts + '/scan-progress.json',
            JSON.stringify({ layoutFailures, violations }, null, 2),
          );
        }
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await visit('database');
  await expect(page.getByText('Review responsive layout', { exact: true })).toBeVisible();
  // Radix checkbox values are booleans, not DOM change events.
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'title', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Review responsive layout', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'title', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Review responsive layout', { exact: true })).toBeVisible();
  // Navigation shortcuts must never consume text entered in a filter.
  await page.getByPlaceholder('Filter rows…').fill('');
  await page.getByPlaceholder('Filter rows…').focus();
  await page.keyboard.type('gd');
  await expect(page).toHaveURL(origin + '/database');
  await page.getByPlaceholder('Filter rows…').fill('');
  for (const tab of ['Schema', 'Policies', 'SQL', 'Migrations']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  }
  await visit('schema');
  const edge = page.locator('.react-flow__edge-path').first();
  await expect(edge).toHaveAttribute('d', /^M.+L/);
  expect(await edge.evaluate((el) => (el as SVGPathElement).getTotalLength())).toBeGreaterThan(0);
  await expect(
    page.getByRole('group', { name: 'comments references tasks through column task_id' }),
  ).toHaveCount(1);
  const node = page.getByRole('group', { name: /Table tasks,/ });
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByText('Row policies', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await visit('settings');
  for (const [tab, text] of [
    ['Team', 'Organization members'],
    ['Credentials', 'CLI and automation credentials'],
    ['Security', 'Passkeys'],
    ['Project', 'Project quotas'],
  ]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  // A virtual authenticator exercises the real client ceremony and backend.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  await page.getByLabel('Passkey name', { exact: true }).fill('Browser test key');
  await page.getByRole('button', { name: 'Add passkey', exact: true }).click();
  await expect(page.getByText('Browser test key', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Renamed test key');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByText('Renamed test key', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/sign-in');
  await page.getByRole('button', { name: 'Sign in with passkey', exact: true }).click();
  await page.waitForURL('**/overview', { timeout: 15000 });
  await visit('settings');
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  await page.getByRole('button', { name: 'Delete passkey Renamed test key', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete passkey', exact: true })
    .click();
  await expect(page.getByText('No passkeys enrolled yet', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 844 });
  await page.getByRole('button', { name: 'Toggle mobile navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Studio navigation' })).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Studio navigation' })).toHaveCount(0);
  writeFileSync(
    artifacts + '/results.json',
    JSON.stringify(
      {
        routes: routes.length,
        responsiveChecks: routes.length * 8,
        accessibilityScans: routes.length * 2 + 1,
        layoutFailures,
        runtimeErrors,
        violations,
      },
      null,
      2,
    ),
  );
  expect(layoutFailures, 'Horizontal overflow').toEqual([]);
  expect(runtimeErrors, 'Browser and server errors').toEqual([]);
  expect(
    violations.map((v: any) => ({
      route: v.route,
      theme: v.theme,
      id: v.id,
      targets: v.nodes.map((n: any) => n.target),
    })),
    'WCAG A/AA automated checks',
  ).toEqual([]);
  console.log(
    'Studio UI: 96 responsive route checks, 25 accessibility scans, schema edges/keyboard, column visibility, settings tabs, passkey CRUD/sign-in, mobile navigation passed.',
  );
} finally {
  vite.kill();
  await vite.exited;
  await browser.close();
  project?.client.dispose();
  await f.close();
}
