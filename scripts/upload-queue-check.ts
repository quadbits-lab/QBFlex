import { chromium, expect, type Route } from '@playwright/test';
import { fixture } from '../tests/helpers';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const reserve = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
const port = reserve.port!;
reserve.stop(true);
const origin = `http://localhost:${port}`;
const f = await fixture({ studioURL: origin, origins: [origin] });
const project = await f.project('queue-browser');
await f.call(
  project.base + '/buckets',
  'POST',
  { name: 'design-assets', visibility: 'private', maxSize: 10485760, mimeRules: [] },
  f.token,
);
const studio = Bun.spawn(['bun', 'run', '--silent', 'dev', '--port', String(port)], {
  cwd: resolve('apps/studio'),
  env: { ...process.env, VITE_API_URL: f.url },
  stdout: 'ignore',
  stderr: 'inherit',
});
const browser = await chromium.launch();
const pending: {
  name: string;
  objectId: string;
  route: Route;
  release: () => void;
  released: boolean;
}[] = [];
const intents = new Map<string, string>();
const errors: string[] = [];
try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/sign-in');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('owner-password-12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
  await sidebar.getByRole('link', { name: 'Storage', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Storage bucket' })).toContainText(
    'design-assets',
  );
  // Controlled transport responses test UI scheduling independently of an external S3 provider.
  // scripts/browser-check.ts separately verifies the actual authenticated upload/storage workflow.
  await page.route('**/management/v1/**/buckets/*/objects', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const input = route.request().postDataJSON();
    const objectId = `queue-object-${intents.size}`;
    intents.set(objectId, input.key);
    expect(route.request().url()).toContain(`/branches/${project.branchId}/`);
    await route.fulfill({ status: 200, json: { data: { id: objectId } } });
  });
  let rejectFirst = false;
  await page.route('**/management/v1/**/objects/*/content', async (route) => {
    const objectId = route.request().url().split('/').at(-2)!;
    const name = intents.get(objectId)!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry = {
      name,
      objectId,
      route,
      release: () => {
        entry.released = true;
        release();
      },
      released: false,
    };
    pending.push(entry);
    await gate;
    const fail = rejectFirst && name === 'retry-me.txt';
    if (fail) rejectFirst = false;
    await route
      .fulfill(
        fail
          ? { status: 503, json: { error: { message: 'Storage temporarily unavailable' } } }
          : { status: 200, json: { data: { state: 'ready' } } },
      )
      .catch(() => {});
  });
  const input = page.getByLabel('Choose file to upload', { exact: true });
  await expect(input).toBeEnabled();
  await input.setInputFiles(
    Array.from({ length: 7 }, (_, index) => ({
      name: `design-${index + 1}.png`,
      mimeType: 'image/png',
      buffer: Buffer.alloc(1024 * (index + 1), index),
    })),
  );
  const panel = page.getByRole('region', { name: 'Upload queue', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(5);
  await expect(panel.getByText('design-5.png', { exact: true })).toBeVisible();
  await expect(panel.getByText('design-6.png', { exact: true })).toHaveCount(0);
  await expect(panel).toContainText('2 active · 5 waiting');
  await expect.poll(() => pending.length).toBe(2);
  await expect(panel.getByRole('progressbar')).toHaveCount(5);
  mkdirSync('verification-artifacts', { recursive: true });
  await page.screenshot({
    path: resolve('verification-artifacts/upload-queue-dark.png'),
    fullPage: true,
  });
  await page.evaluate(() => document.documentElement.classList.add('light'));
  await page.screenshot({
    path: resolve('verification-artifacts/upload-queue-light.png'),
    fullPage: true,
  });
  await sidebar.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(5);
  pending[0]!.release();
  await expect(panel.getByText('Uploaded', { exact: true })).toBeVisible();
  await expect.poll(() => pending.length).toBe(3);
  await expect(panel.getByText('design-1.png', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('design-6.png', { exact: true })).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(5);
  for (let completed = 1; completed < 7; completed++) {
    await expect.poll(() => pending.length).toBeGreaterThan(completed);
    pending[completed]!.release();
  }
  await expect(panel).toHaveCount(0);
  await sidebar.getByRole('link', { name: 'Storage', exact: true }).click();
  rejectFirst = true;
  await input.setInputFiles({
    name: 'retry-me.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('retry content'),
  });
  await expect.poll(() => pending.length).toBe(8);
  pending[7]!.release();
  await expect(panel.getByText('Storage temporarily unavailable')).toBeVisible();
  const originalIntentCount = intents.size;
  await panel.getByRole('button', { name: 'Retry retry-me.txt', exact: true }).click();
  await expect.poll(() => pending.length).toBe(9);
  expect(pending[8]!.objectId).toBe(pending[7]!.objectId);
  expect(intents.size).toBe(originalIntentCount);
  pending[8]!.release();
  await expect(panel).toHaveCount(0);
  await input.setInputFiles(
    Array.from({ length: 6 }, (_, i) => ({
      name: `pending-${i}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('pending'),
    })),
  );
  await expect(panel.getByRole('listitem')).toHaveCount(5);
  await panel.getByRole('button', { name: 'Cancel pending-4.txt', exact: true }).click();
  await expect(panel.getByText('pending-4.txt', { exact: true })).toHaveCount(0);
  expect([...intents.values()]).not.toContain('pending-4.txt');
  await panel.getByRole('button', { name: 'Collapse upload queue' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Expand upload queue' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: resolve('verification-artifacts/upload-queue-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
  console.log(
    'Upload queue browser checks passed: five-row cap, FIFO replacement, completion acknowledgement, navigation, retry identity, cancellation, sign-out cleanup, light/dark/mobile and reduced motion. Transfer responses were controlled fixtures.',
  );
} finally {
  for (const entry of pending) if (!entry.released) entry.release();
  await browser.close();
  studio.kill();
  await studio.exited;
  await f.close();
}
