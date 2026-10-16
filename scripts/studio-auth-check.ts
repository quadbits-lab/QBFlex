import { chromium, expect } from '@playwright/test';
import { fixture } from '../tests/helpers';
import { resolve } from 'node:path';

// Isolated platform owner and ports: never sign into or change the developer's installation.
const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
const port = reservation.port!;
reservation.stop(true);
const studio = `http://localhost:${port}`;
const f = await fixture({
  studioURL: studio,
  origins: [studio, studio.replace('localhost', '127.0.0.1')],
});
const studioProcess = Bun.spawn(['bun', 'run', 'dev', '--port', String(port)], {
  cwd: resolve('apps/studio'),
  env: { ...process.env, VITE_API_URL: f.url, PORT: String(port) },
  stdout: 'ignore',
  stderr: 'inherit',
});
const browser = await chromium.launch();
const errors: string[] = [];
async function credentials(
  page: import('@playwright/test').Page,
  password = 'owner-password-12345',
) {
  await page.getByLabel('Email', { exact: true }).fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(studio)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(100);
  }
  if (!ready) throw new Error('Isolated Studio did not start');
  for (const hostname of ['localhost', '127.0.0.1']) {
    const url = `http://${hostname}:${port}`;
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const privateReads: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/management/')) privateReads.push(request.url());
    });
    await page.goto(url + '/database?tab=rows');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/sign-in');
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/database?tab=rows');
    expect(privateReads).toHaveLength(0);
    await credentials(page);
    await expect(page).toHaveURL(url + '/database?tab=rows');
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
    expect(
      (await context.cookies(url)).some((cookie) => cookie.httpOnly && cookie.domain === hostname),
    ).toBe(true);
    await page.goto(url + '/sign-in');
    await expect(page).toHaveURL(url + '/overview');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    // A failed verification blocks the destination instead of claiming that cookies are missing.
    await page.route('**/platform/auth/get-session', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { message: 'Session service temporarily unavailable' } },
      }),
    );
    await page
      .getByRole('complementary', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Database', exact: true })
      .click();
    await expect(page.getByText('Connection unavailable', { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/database');
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toHaveCount(0);
    await page.unroute('**/platform/auth/get-session');
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
    // Expired/revoked cookies cannot reuse the previously successful route/session cache.
    await context.clearCookies();
    await page
      .getByRole('complementary', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Overview', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in\?/);
    // A nominal success without a cookie must stay on the form, report the cause and never loop.
    await page.route('**/platform/auth/sign-in/email', (route) =>
      route.fulfill({ status: 200, json: { user: { id: 'unverified' } } }),
    );
    await credentials(page);
    await expect(page.getByText(/The browser could not establish a session/)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/sign-in');
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toHaveCount(0);
    await page.unroute('**/platform/auth/sign-in/email');
    await credentials(page, 'incorrect-password-12345');
    await expect(page.getByText('Invalid email or password', { exact: false })).toBeVisible();
    // Better Auth intentionally limits password sign-in to three attempts per ten seconds.
    await Bun.sleep(10_500);
    await credentials(page);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await context.close();
    if (hostname === 'localhost') await Bun.sleep(10_500);
  }
  expect(errors).toEqual([]);
  console.log(
    'Studio auth passed on localhost and 127.0.0.1: protected direct loads, cookie verification, redirect-back, reload, API errors/retry, expiry, bad passwords, sign-out and browser history.',
  );
} finally {
  await browser.close();
  studioProcess.kill();
  await studioProcess.exited;
  await f.close();
}
