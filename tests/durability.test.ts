import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, BranchOwner } from '@qb-flex/database';
test('SIGKILL leaves acknowledged FULL/WAL commits and rolls back an open transaction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-crash-')),
    path = join(directory, 'main.pglite');
  const child = Bun.spawn(['bun', 'tests/fixtures-crash.ts', path], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  try {
    const reader = child.stdout.getReader();
    let output = '';
    while (!output.includes('UNCOMMITTED')) {
      const part = await reader.read();
      if (part.done) throw new Error('Crash fixture exited too early');
      output += new TextDecoder().decode(part.value);
    }
    child.kill('SIGKILL');
    await child.exited;
    const db = openDatabase(path);
    try {
      expect(Number(((await db.query('SELECT COUNT(*) AS n FROM ledger').get()) as any).n)).toBe(
        20,
      );
      expect((await db.query('SELECT 1 AS valid').get())!.valid).toBe(1);
      expect(await db.query('SELECT * FROM ledger WHERE id=21').get()).toBeNull();
    } finally {
      await db.close(true);
    }
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10000);
test('branch queue is bounded, timed-out owners reject ambiguous work and can restart safely', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-owner-'));
  const options = {
    secret: 'test',
    auth: {
      secret: 'at-least-thirty-two-characters-long-secret',
      baseURL: 'http://localhost:7612',
      basePath: '/auth',
      origins: [],
    },
  };
  const path = join(directory, 'main.pglite');
  let owner = new BranchOwner(path, options);
  try {
    await owner.call('schema');
    const jobs = [
      owner
        .call(
          'sql',
          {
            sql: 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n',
          },
          75,
        )
        .catch((e) => e),
      ...Array.from({ length: 63 }, () => owner.call('schema').catch((e) => e)),
    ];
    expect(owner.call('schema')).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    const results = await Promise.all(jobs);
    expect(results.every((result) => result.code === 'OWNER_UNAVAILABLE')).toBe(true);
    expect(owner.available).toBe(false);
    owner = new BranchOwner(path, options);
    expect((await owner.call('schema')).schemaVersion).toBe(1);
  } finally {
    await owner.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10000);
