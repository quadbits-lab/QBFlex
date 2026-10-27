import { test, expect, describe } from 'bun:test';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../helpers';
import { JobExecutor } from '../../apps/worker/src/job-executor';
import { RECOVERY_TEST_HOST } from '@qb-flex/storage';

describe('recovery center', () => {
  test('configures schedule, uploads to a destination, inventories freshness and runs a drill without cutover', async () => {
    const f = await fixture();
    try {
      const project = await f.project('recovery-center');
      const worker = readFileSync(join(f.directory, 'worker.token'), 'utf8').trim();

      const settings = (
        await f.call(`/management/v1/projects/${project.id}/recovery`, 'GET', undefined, f.token)
      ).data;
      expect(settings.enabled).toBe(true);
      expect(settings.intervalHours).toBe(24);
      expect(settings.version).toBe(1);

      const updated = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery`,
          'PUT',
          {
            enabled: true,
            intervalHours: 1,
            retentionDays: 3,
            retentionWeeks: 1,
            drillIntervalHours: 0,
          },
          f.token,
          { 'if-match': '1' },
        )
      ).data;
      expect(updated.intervalHours).toBe(1);
      expect(updated.retentionDays).toBe(3);
      expect(updated.version).toBe(2);

      const destination = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery/destinations`,
          'POST',
          {
            name: 'local-test',
            endpoint: `https://${RECOVERY_TEST_HOST}`,
            region: 'us-east-1',
            bucket: 'recovery-archives',
            prefix: 'qb',
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key-value',
          },
          f.token,
        )
      ).data;
      expect(destination.credentialsConfigured).toBe(true);
      expect(destination.endpoint).toBe(`https://${RECOVERY_TEST_HOST}`);
      expect(destination).not.toHaveProperty('accessKeyId');

      const backup = (
        await f.call(project.base + '/backups', 'POST', {}, f.token)
      ).data;
      expect(backup.id).toMatch(/^[a-f0-9-]{36}$/);

      const inventory = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery/inventory`,
          'GET',
          undefined,
          f.token,
        )
      ).data;
      expect(inventory.items.length).toBeGreaterThanOrEqual(1);
      const item = inventory.items.find((entry: any) => entry.id === backup.id);
      expect(item).toBeTruthy();
      expect(item.replicas.some((replica: any) => replica.state === 'verified')).toBe(true);

      const storeRoot = join(f.directory, 'recovery-store', 'recovery-archives');
      const uploaded = readdirSync(storeRoot, { recursive: true }).some((name) =>
        String(name).endsWith(`${backup.id}.pglite.tar.enc`),
      );
      expect(uploaded).toBe(true);

      const primaryBefore = (
        await f.call(`/management/v1/projects/${project.id}/branches`, 'GET', undefined, f.token)
      ).data.find((branch: any) => branch.name === 'main');

      const drill = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery/drills`,
          'POST',
          { backupId: backup.id },
          f.token,
        )
      ).data;
      expect(drill.state).toBe('queued');

      const executor = new JobExecutor(f.url, worker);
      for (let attempt = 0; attempt < 20; attempt++) {
        await executor.tick();
        const current = (
          await f.call(
            `/management/v1/projects/${project.id}/recovery/drills`,
            'GET',
            undefined,
            f.token,
          )
        ).data.find((entry: any) => entry.id === drill.id);
        if (current && !['queued', 'restoring', 'validating'].includes(current.state)) {
          expect(['complete', 'partial', 'failed']).toContain(current.state);
          expect(current.keyResult).toBe('passed');
          expect(current.databaseResult).toBe('passed');
          // Without configured application object storage, objects remain failed and complete is denied.
          expect(current.objectsResult).toBe('failed');
          expect(current.state).toBe('partial');
          expect(current.report.notes.join(' ')).toMatch(
            /object storage|Object backup|versioning/i,
          );
          break;
        }
        await Bun.sleep(50);
      }

      const primaryAfter = (
        await f.call(`/management/v1/projects/${project.id}/branches`, 'GET', undefined, f.token)
      ).data.find((branch: any) => branch.name === 'main');
      expect(primaryAfter.id).toBe(primaryBefore.id);

      const conflict = await f.response(
        `/management/v1/projects/${project.id}/recovery`,
        'PUT',
        { enabled: false, intervalHours: 24, retentionDays: 3, retentionWeeks: 1 },
        f.token,
        { 'if-match': '1' },
      );
      expect(conflict.status).toBe(409);
    } finally {
      await f.close();
    }
  }, 60000);

  test('keeps the newest checkpoint during retention and reports stale inventory', async () => {
    const f = await fixture();
    try {
      const project = await f.project('recovery-retention');
      await f.call(
        `/management/v1/projects/${project.id}/recovery`,
        'PUT',
        {
          enabled: true,
          intervalHours: 1,
          retentionDays: 1,
          retentionWeeks: 0,
          drillIntervalHours: 0,
        },
        f.token,
        { 'if-match': '1' },
      );
      const first = (await f.call(project.base + '/backups', 'POST', {}, f.token)).data;
      const second = (await f.call(project.base + '/backups', 'POST', {}, f.token)).data;
      await f.service.db
        .query('UPDATE backups SET created_at=? WHERE id=?')
        .run(new Date(Date.now() - 3 * 86400000).toISOString(), first.id);
      await f.service.maintain();
      const remaining = (
        await f.call(`/management/v1/projects/${project.id}/backups`, 'GET', undefined, f.token)
      ).data;
      expect(remaining.some((row: any) => row.id === second.id)).toBe(true);
      expect(remaining.some((row: any) => row.id === first.id)).toBe(false);

      await f.service.db
        .query('UPDATE backups SET created_at=? WHERE id=?')
        .run(new Date(Date.now() - 3 * 3600000).toISOString(), second.id);
      const inventory = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery/inventory`,
          'GET',
          undefined,
          f.token,
        )
      ).data;
      expect(inventory.items[0].stale).toBe(true);
      expect(inventory.findings.some((finding: any) => finding.code === 'BACKUP_STALE')).toBe(true);
    } finally {
      await f.close();
    }
  }, 60000);

  test('corrupt archives and cancelled drills stay isolated from the primary alias', async () => {
    const f = await fixture();
    try {
      const project = await f.project('recovery-corrupt');
      const backup = (await f.call(project.base + '/backups', 'POST', {}, f.token)).data;
      const record = (await f.service.db
        .query('SELECT path FROM backups WHERE id=?')
        .get(backup.id)) as any;
      writeFileSync(record.path, Buffer.from('not-an-archive'));

      const drill = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery/drills`,
          'POST',
          { backupId: backup.id },
          f.token,
        )
      ).data;
      const worker = readFileSync(join(f.directory, 'worker.token'), 'utf8').trim();
      const executor = new JobExecutor(f.url, worker);
      let finished: any;
      for (let attempt = 0; attempt < 20; attempt++) {
        await executor.tick();
        finished = (
          await f.call(
            `/management/v1/projects/${project.id}/recovery/drills`,
            'GET',
            undefined,
            f.token,
          )
        ).data.find((entry: any) => entry.id === drill.id);
        if (finished && !['queued', 'restoring', 'validating'].includes(finished.state)) break;
        await Bun.sleep(50);
      }
      expect(finished.state).toBe('failed');
      expect(finished.keyResult).toBe('failed');
      expect(['BACKUP_CORRUPT', 'KEY_UNAVAILABLE']).toContain(
        (
          await f.call(
            `/management/v1/projects/${project.id}/recovery/inventory`,
            'GET',
            undefined,
            f.token,
          )
        ).data.findings.find((finding: any) => finding.resource === backup.id)?.code,
      );

      const healthy = (await f.call(project.base + '/backups', 'POST', {}, f.token)).data;
      const queued = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery/drills`,
          'POST',
          { backupId: healthy.id },
          f.token,
        )
      ).data;
      const cancelled = (
        await f.call(
          `/management/v1/projects/${project.id}/recovery/drills/${queued.id}/cancel`,
          'POST',
          {},
          f.token,
        )
      ).data;
      expect(cancelled.state).toBe('cancelled');

      const drillsDir = join(f.directory, 'recovery-drills');
      if (existsSync(drillsDir)) {
        expect(readdirSync(drillsDir).length).toBe(0);
      } else {
        mkdirSync(drillsDir, { recursive: true });
        rmSync(drillsDir, { recursive: true, force: true });
      }
    } finally {
      await f.close();
    }
  }, 60000);
});
