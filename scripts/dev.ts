import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { log, printStartup } from '@qb-flex/observability';
import { dependencies } from '../package.json';
const engineVersion = dependencies['@electric-sql/pglite'];
import { readWorkerToken } from '../apps/worker/src/token';
const root = resolve(import.meta.dir, '..');
type Ports = {
  studio: number;
  docs: number;
  api: number;
};
export async function assertDevPortsAvailable(ports: Ports) {
  const probes: ReturnType<typeof createServer>[] = [];
  try {
    const results = await Promise.allSettled(
      Object.entries(ports).map(async ([name, port]) => {
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error(`${name} port must be an integer between 1 and 65535.`);
        const probe = createServer();
        probes.push(probe);
        await new Promise<void>((accept, reject) => {
          probe.once('error', (error: NodeJS.ErrnoException) =>
            reject(
              new Error(
                `${name} port ${port}: ${error.code === 'EADDRINUSE' ? 'already in use' : 'cannot bind'}`,
              ),
            ),
          );
          probe.listen({ host: '127.0.0.1', port, exclusive: true }, accept);
        });
      }),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [String(result.reason.message)] : [],
    );
    if (failures.length)
      throw new Error(
        `Cannot start native development: ${failures.join('; ')}.\n` +
          'If the Docker local stack is running, use its apps directly or switch to hot reload with:\n' +
          'docker compose --profile local stop studio docs api worker\n' +
          'bun run dev\n' +
          'This stop command preserves database and object volumes. Otherwise stop the process occupying the listed ports.',
      );
  } finally {
    await Promise.all(
      probes
        .filter((probe) => probe.listening)
        .map((probe) => new Promise<void>((done) => probe.close(() => done()))),
    );
  }
}
export async function runDevelopment(
  options: {
    ports?: Ports;
    environment?: NodeJS.ProcessEnv;
    startupTimeoutMs?: number;
  } = {},
) {
  const began = performance.now();
  const input = options.environment ?? process.env;
  const ports = options.ports ?? { studio: 7610, docs: 7611, api: Number(input.PORT ?? 7612) };
  const apiURL = `http://localhost:${ports.api}`;
  const studioURL = `http://localhost:${ports.studio}`;
  const docsURL = `http://localhost:${ports.docs}`;
  const environment = {
    ...input,
    QB_DEV_LAUNCHER: '1',
    QB_DATA_DIR: resolve(root, input.QB_DATA_DIR ?? '.data'),
    PORT: String(ports.api),
    QB_INTERNAL_API_URL: apiURL,
    QB_PUBLIC_URL: input.QB_PUBLIC_URL ?? apiURL,
    QB_STUDIO_URL: input.QB_STUDIO_URL ?? studioURL,
    VITE_API_URL: input.VITE_API_URL ?? apiURL,
    VITE_DOCS_URL: input.VITE_DOCS_URL ?? docsURL,
    VITE_STUDIO_URL: input.VITE_STUDIO_URL ?? studioURL,
  };
  const children: {
    name: string;
    process: ReturnType<typeof Bun.spawn>;
  }[] = [];
  let stopped = false;
  const start = (name: string, args: string[], cwd = root) => {
    const process = Bun.spawn(args, {
      cwd,
      env: environment,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    children.push({ name, process });
    return process;
  };
  const close = () => {
    if (stopped) return;
    stopped = true;
    for (const child of children) child.process.kill();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    // Check all listeners before creating local secrets or launching any children.
    await assertDevPortsAvailable(ports);
    if (stopped) return;
    log({ action: 'development.starting' });
    const api = start('API', ['bun', '--no-clear-screen', '--watch', 'apps/api/src/index.ts']);
    const deadline = Date.now() + (options.startupTimeoutMs ?? 30000);
    let ready = false;
    while (Date.now() < deadline && !stopped) {
      if (api.exitCode !== null)
        throw new Error('API exited during startup. Check its preceding error.');
      try {
        const response = await fetch(apiURL + '/ready', { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) {
          // Readiness alone could belong to another installation. Require this
          // data directory's API-generated token (or the configured credential).
          const token = readWorkerToken(environment);
          const authenticated = await fetch(apiURL + '/internal/metrics', {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(1000),
          });
          await authenticated.body?.cancel();
          if (!authenticated.ok)
            throw new Error('The local worker credential was rejected by the API.');
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    if (stopped) return;
    if (!ready)
      throw new Error(
        'Local API did not become ready with its worker credential. Check the API startup error, port and QB_DATA_DIR configuration.',
      );
    start('Worker', ['bun', 'apps/worker/src/index.ts']);
    for (const app of ['studio', 'docs'] as const)
      start(
        app,
        [
          'bun',
          'run',
          '--silent',
          'dev',
          '--port',
          String(ports[app]),
          '--strictPort',
          '--clearScreen',
          'false',
          '--logLevel',
          'warn',
        ],
        resolve(root, 'apps', app),
      );
    // Show "ready" only after both frontends respond, not merely after spawning them.
    await Promise.all(
      [studioURL, docsURL].map(async (address) => {
        while (Date.now() < deadline && !stopped) {
          const failed = children.find((child) => child.process.exitCode !== null);
          if (failed) throw new Error(`${failed.name} exited during startup.`);
          try {
            const response = await fetch(address, { signal: AbortSignal.timeout(1000) });
            await response.body?.cancel();
            if (response.ok) return;
          } catch {}
          await Bun.sleep(100);
        }
        if (!stopped) throw new Error(`Frontend did not become ready: ${address}`);
      }),
    );
    if (stopped) return;
    const bootstrapTokenFile = resolve(environment.QB_DATA_DIR, 'bootstrap.token');
    printStartup({
      mode: 'development',
      elapsedMs: performance.now() - began,
      runtime: Bun.version,
      engineVersion,
      dataDir: environment.QB_DATA_DIR,
      maxOwners: Number(input.QB_MAX_BRANCH_OWNERS ?? 4),
      services: { studio: studioURL, docs: docsURL, api: apiURL },
      ...(existsSync(bootstrapTokenFile) ? { bootstrapTokenFile } : {}),
    });
    const result = await Promise.race(
      children.map(async (child) => ({ name: child.name, code: await child.process.exited })),
    );
    if (!stopped)
      throw new Error(
        `${result.name} exited with code ${result.code}; stopped the remaining development services.`,
      );
  } finally {
    close();
    const force = setTimeout(() => {
      for (const child of children)
        if (child.process.exitCode === null) child.process.kill('SIGKILL');
    }, 5000);
    await Promise.allSettled(children.map((child) => child.process.exited));
    clearTimeout(force);
    process.removeListener('SIGINT', close);
    process.removeListener('SIGTERM', close);
  }
}
if (import.meta.main) {
  try {
    await runDevelopment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Development startup failed.');
    process.exitCode = 1;
  }
}
