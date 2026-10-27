import { test, expect } from 'bun:test';
import { readWorkerToken } from '../apps/worker/src/token';
import {
  formatStartupPanel,
  formatPrettyLog,
  terminalSettings,
  redactLogEvent,
  quietInternalLog,
} from '@qb-flex/observability';

const time = '2026-10-16T08:00:00.123Z';
const startup = {
  mode: 'development' as const,
  elapsedMs: 1234,
  runtime: '1.4.2',
  engineVersion: '0.5.10',
  dataDir: '/isolated/data',
  maxOwners: 4,
  services: {
    studio: 'http://localhost:7610',
    docs: 'http://localhost:7611',
    api: 'http://localhost:7612',
  },
};

test('terminal auto mode keeps production and pipelines JSON; explicit mode and color controls are honored', () => {
  expect(terminalSettings({}, true)).toMatchObject({ format: 'pretty', color: true });
  expect(terminalSettings({}, false)).toMatchObject({ format: 'json', color: false });
  expect(terminalSettings({ NODE_ENV: 'production' }, true).format).toBe('json');
  expect(terminalSettings({ QB_LOG_FORMAT: 'json' }, true).format).toBe('json');
  expect(
    terminalSettings({ QB_LOG_FORMAT: 'pretty', NO_COLOR: '1', FORCE_COLOR: '1' }, true),
  ).toMatchObject({ format: 'pretty', color: false });
  expect(terminalSettings({ QB_LOG_FORMAT: 'pretty', FORCE_COLOR: '1' }, false).color).toBe(true);
  expect(terminalSettings({ TERM: 'dumb' }, true).color).toBe(false);
  expect(terminalSettings({ FORCE_COLOR: '0' }, true).color).toBe(false);
});

test('pretty and JSON logs use the same allowlist and strip credentials, query strings and terminal controls', () => {
  const event = redactLogEvent(
    {
      requestId: '\x1b[31minjected\nnew-line',
      method: 'POST',
      path: '/platform/auth/reset-password/private-token?password=secret#fragment',
      status: 401,
      durationMs: 12.34,
      authorization: 'Bearer hidden',
      body: { password: 'hidden' },
      action: 'safe',
    } as any,
    time,
  );
  const json = JSON.stringify(event);
  const pretty = formatPrettyLog(event, { color: true });
  for (const output of [json, pretty])
    expect(output).not.toMatch(/private-token|secret|fragment|hidden|authorization|password=/);
  expect(event.path).toBe('/platform/auth/reset-password/:token');
  expect(event.requestId).toBe('injected new-line');
  expect(pretty).toContain('\x1b[33m401');
  expect(formatPrettyLog(event)).not.toContain('\x1b');
  expect(formatPrettyLog(event)).toContain('12.3 ms');
  expect(redactLogEvent({ durationMs: NaN, status: Infinity }, time)).toEqual({ time });
});

test('routine worker polling is quiet only when successful and fast; failures and slow calls stay visible', () => {
  expect(
    quietInternalLog(
      redactLogEvent({ path: '/internal/jobs/targets', status: 200, durationMs: 5 }, time),
    ),
  ).toBe(true);
  expect(
    quietInternalLog(redactLogEvent({ path: '/internal/jobs/targets', status: 401 }, time)),
  ).toBe(false);
  expect(
    quietInternalLog(redactLogEvent({ path: '/internal/jobs/claim', status: 503 }, time)),
  ).toBe(false);
  expect(
    quietInternalLog(
      redactLogEvent({ path: '/internal/jobs/targets', status: 200, durationMs: 1001 }, time),
    ),
  ).toBe(false);
  expect(
    quietInternalLog(redactLogEvent({ path: '/platform/auth/get-session', status: 200 }, time)),
  ).toBe(false);
  expect(
    formatPrettyLog(redactLogEvent({ action: 'maintenance.failed' }, time), { color: true }),
  ).toContain('\x1b[31m');
});

test('startup panel shows ready services and engine information without secrets and fits narrow terminals', () => {
  const output = formatStartupPanel({
    ...startup,
    services: {
      api: 'http://user:private@localhost:7612?token=hidden',
      studio: startup.services.studio,
      docs: startup.services.docs,
    },
  });
  expect(output).toContain('QB FLEX');
  expect(output).toContain('Ready in 1.23 s');
  expect(output).toContain('PGlite 0.5.10');
  expect(output).toContain('Bun 1.4.2');
  expect(output).toContain('http://localhost:7612');
  expect(output).not.toMatch(/user:|private@|token=|hidden|Setup/);
  const narrow = formatStartupPanel(
    { ...startup, dataDir: '/very/long/'.repeat(20) },
    { width: 52 },
  );
  for (const line of narrow.trim().split('\n')) expect(line.length).toBe(52);
  expect(
    formatStartupPanel({ ...startup, bootstrapTokenEnv: '/isolated/.env' }),
  ).toContain('QB_BOOTSTRAP_TOKEN');
});

test('Elysia request logs and metrics use the actual Better Auth response status', async () => {
  const { fixture } = await import('./helpers');
  const f = await fixture();
  const original = console.log;
  const previous = process.env.QB_LOG_FORMAT;
  const lines: string[] = [];
  process.env.QB_LOG_FORMAT = 'json';
  console.log = (value) => {
    lines.push(String(value));
  };
  try {
    const response = await f.response('/platform/auth/sign-in/email', 'POST', {
      email: 'owner@example.com',
      password: 'wrong-password-12345',
    });
    expect(response.status).toBe(401);
    await response.body?.cancel();
    const event = lines
      .map((line) => JSON.parse(line))
      .find((value) => value.path === '/platform/auth/sign-in/email');
    expect(event.status).toBe(401);
    const metrics = await f.response(
      '/internal/metrics',
      'GET',
      undefined,
      readWorkerToken({ ...process.env, QB_DATA_DIR: f.directory }),
    );
    expect(await metrics.text()).toContain('qb_http_errors_total{route="POST /platform/auth/*"} 1');
  } finally {
    console.log = original;
    if (previous === undefined) delete process.env.QB_LOG_FORMAT;
    else process.env.QB_LOG_FORMAT = previous;
    await f.close();
  }
});
