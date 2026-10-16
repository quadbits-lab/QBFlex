import { expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encryption, realmSecret } from '@qb-flex/auth';
import {
  encryptControlArchive,
  decryptControlArchive,
} from '../packages/database/src/control-archive';
import { cleanupControlStaging } from '../packages/database/src/control-backup';
import { encryptArchive } from '../packages/database/src/archive';
import { openDatabase } from '../packages/database/src';
import { acquireLease } from '../packages/database/src/lease';
const master = 'isolated-control-test-master-' + 'x'.repeat(32);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const scratch = () => mkdtempSync(join(tmpdir(), 'qb-control-stream-'));
test('control v2 self-contained metadata is authenticated and large snapshots stream with private files', async () => {
  const directory = scratch();
  try {
    const source = join(directory, 'snapshot'),
      archive = join(directory, 'control.enc'),
      target = join(directory, 'restored');
    const bytes = randomBytes(16 * 1048576 + 7);
    writeFileSync(source, bytes);
    const manifest = await encryptControlArchive(source, archive, master);
    expect(manifest.format).toBe(2);
    expect(manifest.checksum).toBe('sha256:' + sha(bytes));
    expect(statSync(archive).mode & 0o777).toBe(0o600);
    expect((await decryptControlArchive(archive, target, master)).size).toBe(bytes.length);
    expect(readFileSync(target)).toEqual(bytes);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    rmSync(target);
    await expect(decryptControlArchive(archive, target, 'wrong-master')).rejects.toMatchObject({
      code: 'BACKUP_CORRUPT',
    });
    expect(existsSync(target)).toBe(false);
    await expect(decryptControlArchive(archive, target, master, { maxBytes: 1 })).rejects.toThrow();
    const changed = readFileSync(archive);
    // Modify a valid JSON digest byte: plaintext size remains plausible but authentication must fail.
    const digestOffset = changed.indexOf(Buffer.from(manifest.checksum)) + 7;
    expect(digestOffset).toBeGreaterThan(7);
    changed[digestOffset] = changed[digestOffset] === 97 ? 98 : 97;
    writeFileSync(archive, changed);
    await expect(decryptControlArchive(archive, target, master)).rejects.toMatchObject({
      code: 'BACKUP_CORRUPT',
    });
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(directory).some((name) => name.includes('.partial-'))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
test('legacy control envelopes restore across both base64 chunk boundaries, with checksums and limits', async () => {
  const directory = scratch();
  try {
    const cipher = encryption(realmSecret(master, 'control-backups'));
    for (const size of [0, 1, 2, 3, 65535, 65536, 65537, 3 * 1048576 + 2]) {
      const bytes = randomBytes(size),
        archive = join(directory, 'legacy-' + size),
        target = archive + '.out';
      writeFileSync(
        archive,
        cipher.seal({
          format: 1,
          createdAt: new Date().toISOString(),
          checksum: sha(bytes),
          data: bytes.toString('base64'),
        }),
      );
      expect((await decryptControlArchive(archive, target, master)).format).toBe(1);
      expect(readFileSync(target)).toEqual(bytes);
    }
    const archive = join(directory, 'bad-legacy'),
      target = archive + '.out';
    for (const value of [
      { format: 1, checksum: '0'.repeat(64), data: Buffer.from('bad').toString('base64') },
      { format: 1, checksum: sha(Buffer.from('bad')), data: '!!!' },
      { format: 3, checksum: sha(Buffer.from('bad')), data: Buffer.from('bad').toString('base64') },
    ]) {
      writeFileSync(archive, cipher.seal({ createdAt: new Date().toISOString(), ...value }));
      await expect(decryptControlArchive(archive, target, master)).rejects.toMatchObject({
        code: 'BACKUP_CORRUPT',
      });
      expect(existsSync(target)).toBe(false);
    }
    writeFileSync(
      archive,
      cipher.seal({
        format: 1,
        createdAt: new Date().toISOString(),
        checksum: sha(Buffer.from('bytes')),
        data: Buffer.from('bytes').toString('base64'),
      }),
    );
    await expect(decryptControlArchive(archive, target, 'wrong-key')).rejects.toThrow();
    await expect(decryptControlArchive(archive, target, master, { maxBytes: 2 })).rejects.toThrow();
    const encoded = readFileSync(archive, 'utf8');
    writeFileSync(
      archive,
      encoded.slice(0, 17) + (encoded[17] === 'A' ? 'B' : 'A') + encoded.slice(18),
    );
    await expect(decryptControlArchive(archive, target, master)).rejects.toMatchObject({
      code: 'BACKUP_CORRUPT',
    });
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(directory).some((name) => name.includes('.partial-'))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('control archive cancellation and cross-kind archives never publish a restore', async () => {
  const directory = scratch();
  try {
    const source = join(directory, 'source'),
      archive = join(directory, 'archive'),
      target = join(directory, 'target');
    writeFileSync(source, randomBytes(100001));
    await encryptControlArchive(source, archive, master);
    const abort = new AbortController();
    abort.abort();
    await expect(
      encryptControlArchive(source, target, master, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      decryptControlArchive(archive, target, master, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(existsSync(target)).toBe(false);
    // Even with the control key, a branch-shaped header is not a control backup.
    const controlKey = Buffer.from(
      realmSecret(realmSecret(master, 'control-backups'), 'encryption'),
      'hex',
    );
    await encryptArchive(source, archive, controlKey);
    await expect(decryptControlArchive(archive, target, master)).rejects.toMatchObject({
      code: 'BACKUP_CORRUPT',
    });
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('lease-protected startup cleanup removes only recognized control staging, not archives or symlink targets', () => {
  const directory = scratch();
  try {
    const folder = join(directory, 'backups/control');
    mkdirSync(folder, { recursive: true });
    const id = crypto.randomUUID(),
      name = '2026-10-06T00-00-00.000Z-' + id + '.sqlite';
    const stage = join(folder, '.control-stage-' + id),
      restore = join(directory, '.control-restore-' + id);
    mkdirSync(stage);
    writeFileSync(join(stage, 'snapshot.sqlite'), 'private');
    mkdirSync(restore);
    writeFileSync(join(folder, name), 'abandoned');
    writeFileSync(join(folder, name + '.enc.partial-' + id), 'abandoned');
    writeFileSync(join(folder, name + '.enc'), 'final');
    writeFileSync(join(folder, 'unrecognized.sqlite'), 'operator-owned');
    const external = join(directory, 'operator-files');
    mkdirSync(external);
    writeFileSync(join(external, 'keep'), 'keep');
    symlinkSync(external, join(folder, '.control-stage-' + crypto.randomUUID()));
    cleanupControlStaging(directory);
    expect(existsSync(stage)).toBe(false);
    expect(existsSync(restore)).toBe(false);
    expect(existsSync(join(folder, name))).toBe(false);
    expect(existsSync(join(folder, name + '.enc.partial-' + id))).toBe(false);
    expect(readFileSync(join(folder, name + '.enc'), 'utf8')).toBe('final');
    expect(readFileSync(join(folder, 'unrecognized.sqlite'), 'utf8')).toBe('operator-owned');
    expect(readFileSync(join(external, 'keep'), 'utf8')).toBe('keep');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('a killed control snapshot releases its volume lock and abandoned plaintext can be swept safely', async () => {
  const directory = scratch();
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const db = openDatabase(join(directory, 'control.sqlite'), false);
    try {
      await db.exec(
        "CREATE TABLE fixture(data BYTEA); INSERT INTO fixture VALUES(decode(repeat('00',67108864),'hex')); ",
      );
    } finally {
      await db.close(true);
    }
    const script = `
      import { openDatabase } from ${JSON.stringify(resolve('packages/database/src/index.ts'))};
      import { acquireLease } from ${JSON.stringify(resolve('packages/database/src/lease.ts'))};
      import { writeControlSnapshot } from ${JSON.stringify(resolve('packages/database/src/control-backup.ts'))};
      const directory = ${JSON.stringify(directory)};
      const release = acquireLease(directory);
      const db = openDatabase(directory + '/control.sqlite', false);
      try { await writeControlSnapshot(db, directory, ${JSON.stringify(master)}); }
      finally { db.close(true); release(); }
    `;
    child = Bun.spawn([process.execPath, '-e', script], {
      cwd: directory,
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const folder = join(directory, 'backups/control');
    let found = false;
    for (let attempt = 0; attempt < 1500; attempt++) {
      if (
        existsSync(folder) &&
        readdirSync(folder).some((name) => name.startsWith('.control-stage-'))
      ) {
        found = true;
        break;
      }
      if (child.exitCode !== null) break;
      await Bun.sleep(2);
    }
    expect(found).toBe(true);
    child.kill('SIGKILL');
    await child.exited;
    const release = acquireLease(directory);
    try {
      cleanupControlStaging(directory);
    } finally {
      release();
    }
    expect(
      readdirSync(folder).some(
        (name) => name.startsWith('.control-stage-') || name.includes('.partial-'),
      ),
    ).toBe(false);
    const intact = openDatabase(join(directory, 'control.sqlite'), false);
    try {
      expect(
        ((await intact.query('SELECT length(data) AS size FROM fixture').get()) as any).size,
      ).toBe(67108864);
    } finally {
      await intact.close(true);
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
      await child.exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
