import { test, expect } from 'bun:test';
import { fixture } from '../helpers';
import {
  writeControlSnapshot,
  restoreControlSnapshot,
} from '../../packages/database/src/control-backup';
import { createService } from '../../apps/api/src/service';
import {
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  renameSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { encryption, realmSecret } from '@qb-flex/auth';
import { restoreDatabase, openDatabase, branchPath } from '../../packages/database/src';
import { resolve } from 'node:path';
import { encryptControlArchive } from '../../packages/database/src/control-archive';
test('encrypted control recovery validates the catalog, fences a live owner and revokes restored credentials', async () => {
  const f = await fixture();
  let recovered: Awaited<ReturnType<typeof createService>> | undefined;
  try {
    const project = await f.project('control-recovery');
    const archive = await writeControlSnapshot(f.service.db, f.directory, f.service.config.master);
    expect(archive.format).toBe(2);
    expect(archive.checksum).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      restoreControlSnapshot(f.directory, f.service.config.master, archive.path),
    ).rejects.toThrow('Another process');
    await f.service.close();
    await expect(
      restoreControlSnapshot(
        f.directory,
        'wrong-master-key-of-thirty-two-characters',
        archive.path,
      ),
    ).rejects.toThrow();
    const result = await restoreControlSnapshot(f.directory, f.service.config.master, archive.path);
    expect(result.keysRevoked).toBe(true);
    expect(result.rollback).toBeDefined();
    recovered = await createService(f.service.config);
    expect(
      ((await recovered.db.query('SELECT slug FROM projects WHERE id=?').get(project.id)) as any)
        .slug,
    ).toBe('control-recovery');
    expect(
      await recovered.platform.api.getSession({
        headers: new Headers({ authorization: 'Bearer ' + f.token }),
      }),
    ).toBeNull();
    expect(
      (
        (await recovered.db
          .query('SELECT revoked_at FROM project_keys WHERE project_id=?')
          .get(project.id)) as any
      ).revoked_at,
    ).toBeTruthy();
    project.client.dispose();
  } finally {
    await recovered?.close();
    await f.close();
  }
}, 15000);
test('legacy control catalog recovery retains projects and revokes restored platform credentials', async () => {
  const f = await fixture();
  let recovered: Awaited<ReturnType<typeof createService>> | undefined;
  try {
    const project = await f.project('legacy-control-recovery');
    const raw = join(f.directory, 'legacy-fixture.tar'),
      archive = raw + '.enc';
    await f.service.db.snapshot(raw);
    const bytes = readFileSync(raw);
    const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    writeFileSync(
      archive,
      encryption(realmSecret(f.service.config.master, 'control-backups')).seal({
        format: 1,
        createdAt: new Date().toISOString(),
        checksum: digest,
        data: bytes.toString('base64'),
      }),
    );
    rmSync(raw);
    await f.service.close();
    const result = await restoreControlSnapshot(f.directory, f.service.config.master, archive);
    expect(result.format).toBe(1);
    expect(result.keysRevoked).toBe(true);
    recovered = await createService(f.service.config);
    expect(
      ((await recovered.db.query('SELECT slug FROM projects WHERE id=?').get(project.id)) as any)
        .slug,
    ).toBe('legacy-control-recovery');
    expect(
      await recovered.platform.api.getSession({
        headers: new Headers({ authorization: 'Bearer ' + f.token }),
      }),
    ).toBeNull();
    project.client.dispose();
  } finally {
    await recovered?.close();
    await f.close();
  }
}, 15000);
test('control snapshot concurrency and cancellation clean private plaintext and preserve the live catalog', async () => {
  const f = await fixture();
  try {
    await f.service.db.exec(
      "CREATE TABLE control_stream_fixture(data BYTEA); INSERT INTO control_stream_fixture VALUES(decode(repeat('00',16777216),'hex'));",
    );
    const first = writeControlSnapshot(f.service.db, f.directory, f.service.config.master);
    await expect(
      writeControlSnapshot(f.service.db, f.directory, f.service.config.master),
    ).rejects.toMatchObject({ code: 'QUOTA' });
    await first;
    const folder = join(f.directory, 'backups/control'),
      before = readdirSync(folder);
    const abort = new AbortController();
    const cancelled = writeControlSnapshot(f.service.db, f.directory, f.service.config.master, {
      signal: abort.signal,
    });
    const timer = setTimeout(() => abort.abort(), 1);
    try {
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      clearTimeout(timer);
    }
    expect(readdirSync(folder)).toEqual(before);
    expect(
      (
        (await f.service.db
          .query('SELECT length(data) AS size FROM control_stream_fixture')
          .get()) as any
      ).size,
    ).toBe(16777216);
    await expect(
      writeControlSnapshot(f.service.db, f.directory, f.service.config.master, { maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'SIZE_LIMIT' });
    expect(readdirSync(folder)).toEqual(before);
  } finally {
    await f.close();
  }
}, 15000);
test('missing referenced branch files prevent control replacement and leave no restore staging', async () => {
  const f = await fixture();
  try {
    const project = await f.project('control-dependency');
    const archive = await writeControlSnapshot(f.service.db, f.directory, f.service.config.master);
    await f.service.db
      .query('UPDATE projects SET name=? WHERE id=?')
      .run('Newer live value', project.id);
    await f.service.close();
    const branch = branchPath(f.directory, project.id, project.branchId);
    renameSync(branch, branch + '.missing');
    await expect(
      restoreControlSnapshot(f.directory, f.service.config.master, archive.path),
    ).rejects.toMatchObject({ code: 'RESTORE_DEPENDENCIES' });
    mkdirSync(branch);
    await expect(
      restoreControlSnapshot(f.directory, f.service.config.master, archive.path),
    ).rejects.toMatchObject({ code: 'RESTORE_DEPENDENCIES' });
    rmSync(branch, { recursive: true });
    expect(existsSync(archive.path)).toBe(true);
    expect(readdirSync(f.directory).some((name) => name.startsWith('.control-restore-'))).toBe(
      false,
    );
    const current = openDatabase(join(f.directory, 'control.pglite'), false);
    try {
      expect(
        ((await current.query('SELECT name FROM projects WHERE id=?').get(project.id)) as any).name,
      ).toBe('Newer live value');
    } finally {
      await current.close(true);
    }
    renameSync(branch + '.missing', branch);
    project.client.dispose();
  } finally {
    await f.close();
  }
}, 15000);
test('maintenance and shutdown drain streamed control snapshots without releasing the owner early', async () => {
  const f = await fixture();
  try {
    const work = f.service.maintain();
    await expect(f.service.maintain()).resolves.toMatchObject({ running: true });
    const close = await f.service.close();
    await work;
    await close;
    await expect(f.service.maintain()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const folder = join(f.directory, 'backups/control');
    expect(readdirSync(folder).filter((name) => name.endsWith('.pglite.tar.enc'))).toHaveLength(1);
    expect(readdirSync(folder).some((name) => name.startsWith('.control-stage-'))).toBe(false);
  } finally {
    await f.close();
  }
}, 15000);
test('offline CLI control create/restore waits for streams and keeps its result contract', async () => {
  const f = await fixture();
  try {
    await f.service.close();
    const cli = resolve('apps/cli/src/index.ts');
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, cli, ...args], {
        cwd: f.directory,
        env: { ...process.env, QB_MASTER_KEY: f.service.config.master },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code) throw new Error(stderr);
      return JSON.parse(stdout);
    };
    const archive = await run('backup', 'control-create', '--data-dir', f.directory);
    expect(archive.format).toBe(2);
    expect(archive.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(archive.path).subarray(0, 9).toString()).toBe('QBFARCH2\n');
    const result = await run(
      'backup',
      'control-restore',
      '--data-dir',
      f.directory,
      '--file',
      archive.path,
      '--confirm-local-control-restore',
    );
    expect(result.restored).toBe(true);
    expect(result.keysRevoked).toBe(true);
    expect(result.platformSessionsExcluded).toBe(true);
    expect(result.rollback).toBeDefined();
    expect(result.format).toBe(2);
  } finally {
    await f.close();
  }
}, 15000);
test('authenticated control archives with invalid migration evidence cannot replace the catalog', async () => {
  const f = await fixture();
  try {
    const source = join(f.directory, 'migration-fixture.tar');
    await f.service.db.snapshot(source);
    await f.service.close();
    for (const invalid of ['checksum', 'unsupported-runtime']) {
      const temporary = source + '.' + invalid + '.pglite';
      await restoreDatabase(source, temporary);
      const scratch = openDatabase(temporary, false);
      try {
        if (invalid === 'checksum')
          await scratch.query('UPDATE engine_migrations SET checksum=$1').run('0'.repeat(64));
        else
          await scratch
            .query('UPDATE engine_migrations SET id=$1 WHERE id=$2')
            .run('999-unsupported', '001-foundation');
        await scratch.snapshot(source + '.' + invalid + '.tar');
      } finally {
        await scratch.close();
      }
      const archive = source + '.' + invalid + '.enc';
      await encryptControlArchive(
        source + '.' + invalid + '.tar',
        archive,
        f.service.config.master,
      );
      await expect(
        restoreControlSnapshot(f.directory, f.service.config.master, archive),
      ).rejects.toMatchObject({ code: 'RESTORE_INVALID' });
      const untouched = openDatabase(join(f.directory, 'control.pglite'), false);
      try {
        expect(
          await untouched
            .query('SELECT id FROM engine_migrations WHERE id=?')
            .get('001-foundation'),
        ).toBeTruthy();
      } finally {
        await untouched.close(true);
      }
      expect(readdirSync(f.directory).some((name) => name.startsWith('.control-restore-'))).toBe(
        false,
      );
    }
  } finally {
    await f.close();
  }
}, 15000);
