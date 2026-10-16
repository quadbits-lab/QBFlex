import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encryption } from '@qb-flex/auth';
import { initializeBranch, expose } from '@qb-flex/schema';
import { openDatabase } from '../packages/database/src/index';
import { BranchEngine } from '../packages/database/src/engine';
import { DurableJobs } from '../packages/database/src/jobs';
import { Webhooks } from '../packages/database/src/webhooks';
test('SIGKILL rolls back incomplete webhook fanout; committed leases reopen with stable IDs and fence late results', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-webhook-crash-'));
  const path = join(directory, 'branch.pglite'),
    marker = join(directory, 'marker.json');
  const master = 'isolated-webhook-crash-master-key-32-characters';
  const keyId = '11111111-1111-1111-1111-111111111111';
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const db = openDatabase(path);
    try {
      await initializeBranch(db);
      const engine = await new BranchEngine(db, 'isolated-crash-engine').initialize();
      await engine.migration('001', 'CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT);', 'test');
      await expose(db, 'tasks', true, ['id', 'title']);
      await engine.savePolicy({
        resource: 'tasks',
        operation: 'select',
        roles: ['service'],
        mode: 'permissive',
        using: { op: 'true' },
        check: { op: 'true' },
        enabled: true,
      });
      const cipher = encryption(master),
        jobs = await new DurableJobs(db, cipher, () => 1000000).initialize();
      await (
        await new Webhooks(engine, jobs, cipher, 'crash-branch', () => 1000000).initialize()
      ).create({
        name: 'Crash fixture',
        url: 'https://receiver.example/events',
        serviceKeyId: keyId,
        table: 'tasks',
        events: ['insert'],
        columns: ['id', 'title'],
      });
      await engine.mutate(
        'tasks',
        'insert',
        { id: 'committed-row', title: 'Synthetic' },
        { sub: null, role: 'anonymous' },
        undefined,
        undefined,
        true,
      );
    } finally {
      await db.close(true);
    }
    for (const committed of [false, true]) {
      rmSync(marker, { force: true });
      const script = `
        import { writeFileSync } from 'node:fs';
        import { encryption } from ${JSON.stringify(resolve('packages/auth/src/index.ts'))};
        import { openDatabase } from ${JSON.stringify(resolve('packages/database/src/index.ts'))};
        import { BranchEngine } from ${JSON.stringify(resolve('packages/database/src/engine.ts'))};
        import { DurableJobs } from ${JSON.stringify(resolve('packages/database/src/jobs.ts'))};
        import { Webhooks } from ${JSON.stringify(resolve('packages/database/src/webhooks.ts'))};
        const db = openDatabase(${JSON.stringify(path)}), cipher = encryption(${JSON.stringify(master)});
        const jobs = await new DurableJobs(db, cipher, () => 1000000).initialize();
        const engine=await new BranchEngine(db,'isolated-crash-engine').initialize();
        const hooks = await new Webhooks(engine, jobs, cipher, 'crash-branch', () => 1000000).initialize();
        const stop = (value) => {
          writeFileSync(${JSON.stringify(marker)}, JSON.stringify(value));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        };
        ${
          committed
            ? "await hooks.produce(); stop(await jobs.claim(['webhook.delivery'], 1000));"
            : 'await db.transaction(async tx => { await hooks.produce(); stop({ pending: true }); }).immediate();'
        }
      `;
      child = Bun.spawn([process.execPath, '-e', script], {
        cwd: resolve('.'),
        stdout: 'ignore',
        stderr: 'pipe',
      });
      for (let i = 0; i < 1000 && !existsSync(marker) && child.exitCode === null; i++)
        await Bun.sleep(5);
      if (!existsSync(marker)) {
        child.kill('SIGKILL');
        await child.exited;
        throw new Error(
          'Crash fixture did not reach its checkpoint: ' +
            (await new Response(child.stderr as ReadableStream<Uint8Array>).text()),
        );
      }
      const before = JSON.parse(readFileSync(marker, 'utf8'));
      child.kill('SIGKILL');
      await child.exited;
      child = undefined;
      const reopened = openDatabase(path);
      try {
        let now = 1000000;
        const cipher = encryption(master),
          jobs = await new DurableJobs(reopened, cipher, () => now).initialize();
        const hooks = await new Webhooks(
          await new BranchEngine(reopened, 'isolated-crash-engine').initialize(),
          jobs,
          cipher,
          'crash-branch',
          () => now,
        ).initialize();
        expect((await hooks.list())[0]!.checkpoint).toBe(committed ? 1 : 0);
        expect(await jobs.list()).toHaveLength(committed ? 1 : 0);
        expect(await reopened.query('SELECT count(*) AS n FROM tasks').get()).toEqual({ n: 1 });
        if (committed) {
          now += 1000;
          await expect(
            (async () => await hooks.prepare(before.id, before.leaseToken, keyId))(),
          ).rejects.toThrow('lease no longer valid');
          const reclaimed = (await jobs.claim(['webhook.delivery']))!;
          expect(reclaimed.id).toBe(before.id);
          expect(reclaimed.eventId).toBe(before.eventId);
          expect(reclaimed.leaseToken).not.toBe(before.leaseToken);
          expect((await hooks.prepare(reclaimed.id, reclaimed.leaseToken, keyId)).skipped).toBe(
            false,
          );
          await jobs.finish(reclaimed.id, reclaimed.leaseToken, { success: true }, [
            'webhook.delivery',
          ]);
          expect((await hooks.produce()).submitted).toBe(0);
          expect((await jobs.get(reclaimed.id)).state).toBe('succeeded');
        }
      } finally {
        await reopened.close(true);
      }
    }
  } finally {
    if (child) {
      child.kill('SIGKILL');
      await child.exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
