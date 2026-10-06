import { cpus, platform, arch } from 'node:os';
import { readFileSync, statfsSync } from 'node:fs';
import { fixture } from '../tests/helpers';
const f = await fixture(),
  dataset = 1_000_000;
const readOptional = (path: string) => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
};
async function paced(rate: number, count: number, operation: () => Promise<unknown>) {
  const started = performance.now(),
    jobs: Promise<void>[] = [],
    latencies: number[] = [];
  let failures = 0;
  for (let i = 0; i < count; i++) {
    await Bun.sleep(Math.max(0, (i * 1000) / rate - (performance.now() - started)));
    jobs.push(
      (async () => {
        const start = performance.now();
        try {
          await operation();
        } catch {
          failures++;
        }
        latencies.push(performance.now() - start);
      })(),
    );
  }
  await Promise.all(jobs);
  latencies.sort((a, b) => a - b);
  return {
    requestedRate: rate,
    requests: count,
    failures,
    seconds: (performance.now() - started) / 1000,
    p50Ms: latencies[Math.floor(count * 0.5)],
    p95Ms: latencies[Math.floor(count * 0.95)],
    maxMs: latencies.at(-1),
  };
}
try {
  const project = await f.project('benchmark');
  const session = await project.client.auth.signUp({
    name: 'Benchmark',
    email: 'benchmark@example.com',
    password: 'benchmark-password-12345',
  });
  await f.call(
    project.base + '/exposure/tasks',
    'PUT',
    { enabled: false, columns: ['id', 'owner_id', 'title', 'completed', 'revision'] },
    f.token,
  );
  const seed = performance.now();
  await f.call(
    project.base + '/migrations',
    'POST',
    {
      id: 'benchmark-seed',
      sql: `CREATE INDEX tasks_owner_id ON tasks(owner_id,id); WITH RECURSIVE rows(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM rows WHERE n<${dataset}) INSERT INTO tasks(id,owner_id,title) SELECT printf('%010d',n),'${session!.user.id}','Task '||n FROM rows;`,
    },
    f.token,
  );
  const seedMs = performance.now() - seed;
  await f.call(
    project.base + '/exposure/tasks',
    'PUT',
    { enabled: true, columns: ['id', 'owner_id', 'title', 'completed', 'revision'] },
    f.token,
  );
  const config = (
    await f.call('/management/v1/projects/' + project.id + '/config', 'GET', undefined, f.token)
  ).data;
  await f.call(
    '/management/v1/projects/' + project.id + '/config',
    'PUT',
    { quotas: { requestsPerMinute: 60000, databaseBytes: 2147483648 } },
    f.token,
    { 'if-match': String(config.version) },
  );
  const reads = await paced(100, 1000, () => project.client.from('tasks').limit(20).execute());
  let connected = false;
  const pendingEvents = new Map<string, number>(),
    eventLatencies: number[] = [];
  const channel = project.client
    .channel({
      table: 'tasks',
      onStatus: (status) => {
        connected = status === 'connected';
      },
      onEvent: (event) => {
        const start = pendingEvents.get(String(event.payload.id));
        if (start !== undefined) {
          eventLatencies.push(performance.now() - start);
          pendingEvents.delete(String(event.payload.id));
        }
      },
    })
    .subscribe();
  const connectionDeadline = Date.now() + 5000;
  while (!connected && Date.now() < connectionDeadline) await Bun.sleep(20);
  if (!connected) throw new Error('Benchmark realtime connection failed');
  let sequence = 0;
  const writes = await paced(25, 100, () => {
    const id = 'measured-write-' + sequence++;
    pendingEvents.set(id, performance.now());
    return project.client
      .from('tasks')
      .insert(
        { id, owner_id: session!.user.id, title: 'Measured write' },
        { idempotencyKey: crypto.randomUUID() },
      );
  });
  const eventDeadline = Date.now() + 5000;
  while (pendingEvents.size && Date.now() < eventDeadline) await Bun.sleep(20);
  channel.unsubscribe();
  eventLatencies.sort((a, b) => a - b);
  const snapshot = performance.now(),
    backup = (await f.call(project.base + '/backups', 'POST', {}, f.token)).data;
  const backupMs = performance.now() - snapshot,
    restore = performance.now();
  await f.call(
    '/management/v1/projects/' + project.id + '/backups/' + backup.id + '/restore',
    'POST',
    {},
    f.token,
  );
  const restoreMs = performance.now() - restore;
  console.log(
    JSON.stringify(
      {
        benchmark: 'QB Flex indexed owner policy / FULL+WAL',
        environment: {
          bun: Bun.version,
          platform: platform(),
          arch: arch(),
          cpu: cpus()[0]?.model,
          cpuQuota: readOptional('/sys/fs/cgroup/cpu.max'),
          memoryLimit: readOptional('/sys/fs/cgroup/memory.max'),
          filesystemType: statfsSync(f.directory).type.toString(16),
        },
        dataset,
        seedMs,
        reads,
        writes,
        realtime: {
          events: eventLatencies.length,
          missing: pendingEvents.size,
          p95Ms: eventLatencies[Math.floor(eventLatencies.length * 0.95)],
          maxMs: eventLatencies.at(-1),
          measurement: 'request start to authorized SDK event; includes commit time',
        },
        backupMs,
        restoreMs,
      },
      null,
      2,
    ),
  );
  if (reads.failures || writes.failures || pendingEvents.size)
    throw new Error('Benchmark returned failures');
  project.client.dispose();
} finally {
  await f.close();
}
