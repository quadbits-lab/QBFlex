import { test, expect } from 'bun:test';
import { fixture } from '../helpers';
import {
  writeControlSnapshot,
  restoreControlSnapshot,
} from '../../packages/database/src/control-backup';
import { createService } from '../../apps/api/src/service';
test('encrypted control recovery validates the catalog, fences a live owner and revokes restored credentials', async () => {
  const f = await fixture();
  let recovered: Awaited<ReturnType<typeof createService>> | undefined;
  try {
    const project = await f.project('control-recovery');
    const archive = writeControlSnapshot(f.service.db, f.directory, f.service.config.master);
    expect(() =>
      restoreControlSnapshot(f.directory, f.service.config.master, archive.path),
    ).toThrow('Another API process');
    await f.service.close();
    expect(() =>
      restoreControlSnapshot(
        f.directory,
        'wrong-master-key-of-thirty-two-characters',
        archive.path,
      ),
    ).toThrow('integrity validation');
    const result = restoreControlSnapshot(f.directory, f.service.config.master, archive.path);
    expect(result.keysRevoked).toBe(true);
    expect(result.rollback).toBeDefined();
    recovered = await createService(f.service.config);
    expect(
      (recovered.db.query('SELECT slug FROM projects WHERE id=?').get(project.id) as any).slug,
    ).toBe('control-recovery');
    expect(
      await recovered.platform.api.getSession({
        headers: new Headers({ authorization: 'Bearer ' + f.token }),
      }),
    ).toBeNull();
    expect(
      (
        recovered.db
          .query('SELECT revoked_at FROM project_keys WHERE project_id=?')
          .get(project.id) as any
      ).revoked_at,
    ).toBeTruthy();
    project.client.dispose();
  } finally {
    await recovered?.close();
    await f.close();
  }
}, 15000);
