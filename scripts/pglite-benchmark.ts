/** Isolated startup/RSS measurement, not a production throughput certification. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BranchOwner } from '@qb-flex/database';
const directory = mkdtempSync(join(tmpdir(), 'qb-pglite-benchmark-'));
const owners: BranchOwner[] = [];
const baseline = process.memoryUsage().rss;
const samples: { owners: number; startupMs: number; rssBytes: number }[] = [];
try {
  for (let i = 0; i < 4; i++) {
    const start = performance.now();
    const owner = new BranchOwner(join(directory, String(i), 'main.pglite'), {
      secret: 'benchmark-realm-secret-at-least-32-characters',
      branchId: crypto.randomUUID(),
      auth: {
        secret: 'benchmark-auth-secret-at-least-32-characters',
        baseURL: 'http://localhost:7612',
        basePath: '/auth',
        origins: [],
      },
    });
    owners.push(owner);
    await owner.call('schema', { privileged: true });
    samples.push({
      owners: i + 1,
      startupMs: Math.round(performance.now() - start),
      rssBytes: process.memoryUsage().rss,
    });
  }
  console.log(
    JSON.stringify(
      {
        engine: 'pglite',
        version: '0.5.10',
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
        measuredAt: new Date().toISOString(),
        baselineRssBytes: baseline,
        samples,
        limitations:
          'Four isolated empty branch owners, including authentication initialization; short local startup/RSS measurement, not throughput or production capacity certification.',
      },
      null,
      2,
    ),
  );
} finally {
  for (const owner of owners) await owner.close();
  rmSync(directory, { recursive: true, force: true });
}
