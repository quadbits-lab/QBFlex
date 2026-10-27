import { test, expect } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDevPortsAvailable } from '../scripts/dev';
import { readWorkerToken } from '../apps/worker/src/token';

type Ports = { studio: number; docs: number; api: number };
function allocate() {
  const servers = Array.from({ length: 3 }, () =>
    Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ status: 'ready' }),
    }),
  );
  const ports = { studio: servers[0]!.port!, docs: servers[1]!.port!, api: servers[2]!.port! };
  return { ports, servers };
}
function launch(directory: string, ports: Ports, override: NodeJS.ProcessEnv = {}) {
  const child = Bun.spawn(['bun', 'tests/fixtures-dev.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      QB_TEST_DEV_PORTS: JSON.stringify(ports),
      QB_DATA_DIR: directory,
      QB_MASTER_KEY: '',
      QB_BOOTSTRAP_TOKEN: '',
      QB_WORKER_TOKEN: '',
      QB_PUBLIC_URL: `http://localhost:${ports.api}`,
      QB_STUDIO_URL: `http://localhost:${ports.studio}`,
      QB_ALLOWED_ORIGINS: `http://localhost:${ports.studio}`,
      VITE_API_URL: `http://localhost:${ports.api}`,
      VITE_DOCS_URL: `http://localhost:${ports.docs}`,
      VITE_STUDIO_URL: `http://localhost:${ports.studio}`,
      ...override,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let output = '';
  async function drain(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        output += decoder.decode(part.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
  const drained = Promise.all([drain(child.stdout), drain(child.stderr)]);
  return {
    child,
    drained,
    get output() {
      return output;
    },
  };
}
async function ready(port: number) {
  try {
    const response = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(500) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
async function waitUntil(condition: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await Bun.sleep(50);
  }
  throw new Error(message);
}
async function stop(run: ReturnType<typeof launch>) {
  run.child.kill();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run.child.exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Dev shutdown did not complete')), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  await run.drained;
}

test('worker credentials belong to the API; missing configuration fails without minting a token', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-worker-token-'));
  try {
    const environment = { QB_DATA_DIR: directory, NODE_ENV: 'development', QB_WORKER_TOKEN: '' };
    expect(() => readWorkerToken(environment)).toThrow('Start the API first');
    expect(existsSync(join(directory, 'worker.token'))).toBe(false);
    writeFileSync(join(directory, 'worker.token'), 'test-file-credential\n', { mode: 0o600 });
    expect(readWorkerToken(environment)).toBe('test-file-credential');
    expect(readWorkerToken({ ...environment, QB_WORKER_TOKEN: 'test-env-credential' })).toBe(
      'test-env-credential',
    );
    expect(() => readWorkerToken({ ...environment, NODE_ENV: 'production' })).toThrow(
      'Set QB_WORKER_TOKEN',
    );
    writeFileSync(join(directory, 'worker.token'), '');
    expect(() => readWorkerToken(environment)).toThrow('worker.token is empty');
    rmSync(join(directory, 'worker.token'));
    const child = Bun.spawn(['bun', 'apps/worker/src/index.ts'], {
      env: { ...process.env, ...environment },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    expect(await output).toContain('Start the API first');
    expect(await output).not.toContain('ENOENT');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a foreign ready API or occupied app port cannot bootstrap the native worker or local data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-dev-conflict-'));
  const { ports, servers } = allocate();
  servers[0]!.stop(true);
  servers[1]!.stop(true);
  let run: ReturnType<typeof launch> | undefined;
  try {
    run = launch(directory, ports);
    expect(await run.child.exited).toBe(1);
    await run.drained;
    expect(run.output).toContain(`api port ${ports.api}: already in use`);
    expect(run.output).toContain('docker compose --profile local stop studio docs api worker');
    expect(run.output).not.toContain('ENOENT');
    expect(run.output).not.toContain('api.started');
    expect(existsSync(join(directory, 'control.pglite'))).toBe(false);
    expect(existsSync(join(directory, 'worker.token'))).toBe(false);
    servers[2]!.stop(true);
    await assertDevPortsAvailable(ports);
    const occupiedStudio = Bun.serve({
      hostname: '127.0.0.1',
      port: ports.studio,
      fetch: () => new Response('another app'),
    });
    try {
      await expect(assertDevPortsAvailable(ports)).rejects.toThrow(
        `studio port ${ports.studio}: already in use`,
      );
    } finally {
      occupiedStudio.stop(true);
    }
    await assertDevPortsAvailable(ports);
  } finally {
    run?.child.kill();
    for (const server of servers) server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('clean native startup creates private API credentials, runs maintenance and both apps, and restarts cleanly', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-dev-clean-'));
  const { ports, servers } = allocate();
  for (const server of servers) server.stop(true);
  let run: ReturnType<typeof launch> | undefined;
  let token = '';
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      run = launch(
        directory,
        ports,
        attempt ? { QB_LOG_FORMAT: 'pretty', NO_COLOR: '1' } : { QB_LOG_FORMAT: 'json' },
      );
      await waitUntil(async () => {
        if (run!.child.exitCode !== null) throw new Error(run!.output);
        return (
          run!.output.includes('maintenance.completed') &&
          run!.output.includes(attempt ? 'QB FLEX' : 'development.ready') &&
          (await ready(ports.studio)) &&
          (await ready(ports.docs))
        );
      }, 'Native apps and maintenance did not start');
      const current = readFileSync(join(directory, 'worker.token'), 'utf8').trim();
      expect(current.length).toBeGreaterThan(32);
      if (attempt) expect(current).toBe(token);
      token = current;
      expect(statSync(join(directory, 'worker.token')).mode & 0o777).toBe(0o600);
      const metrics = await fetch(`http://localhost:${ports.api}/internal/metrics`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(metrics.status).toBe(200);
      await metrics.body?.cancel();
      const setup = await fetch(`http://localhost:${ports.api}/setup`);
      expect((await setup.json()).data.required).toBe(true);
      expect(run.output).not.toContain(token);
      if (attempt) {
        expect(run.output).toContain('PGlite 0.5.');
        expect(run.output).toContain('http://localhost:' + ports.studio);
        expect(run.output).not.toContain('VITE v');
        expect(run.output).not.toContain('\x1b[');
      }
      expect(run.output).not.toContain('maintenance.failed');
      expect(run.output).not.toContain('ENOENT');
      await stop(run);
      expect(run.child.exitCode).toBe(0);
      expect(run.output).not.toContain(token);
      run = undefined;
      await assertDevPortsAvailable(ports);
    }
  } finally {
    if (run) await stop(run);
    rmSync(directory, { recursive: true, force: true });
  }
}, 45000);

test('failed API initialization stops the launcher without starting worker or frontends', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-dev-failed-'));
  const { ports, servers } = allocate();
  for (const server of servers) server.stop(true);
  const run = launch(directory, ports, { NODE_ENV: 'production', QB_TEST_DEV_TIMEOUT: '2500' });
  try {
    expect(await run.child.exited).toBe(1);
    await run.drained;
    expect(run.output).toContain('QB_MASTER_KEY is required in production');
    expect(run.output).not.toContain('maintenance.completed');
    expect(run.output).not.toContain('$ vite');
    expect(run.output).not.toContain('ENOENT');
    expect(existsSync(join(directory, 'worker.token'))).toBe(false);
    await assertDevPortsAvailable(ports);
  } finally {
    run.child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10000);
