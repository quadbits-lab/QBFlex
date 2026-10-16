import { type Database, restoreDatabase, databaseBytes } from './connection';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  chmodSync,
  statfsSync,
  readdirSync,
  lstatSync,
  statSync,
  renameSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { rename, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { QBError } from '@qb-flex/contracts';
import { openDatabase, branchPath } from './index';
import { acquireLease } from './lease';
import {
  encryptControlArchive,
  decryptControlArchive,
  type ControlArchiveOptions,
} from './control-archive';
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const activeSnapshots = new WeakSet<Database>();
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const archiveName = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}Z-' + uuid;
/** Only invoke while holding the exclusive volume lease; never sweep live/final archives. */
export function cleanupControlStaging(directory: string) {
  const journal = join(directory, '.control-swap.json');
  if (existsSync(journal)) {
    const swap = JSON.parse(readFileSync(journal, 'utf8'));
    if (
      swap.current !== join(directory, 'control.pglite') ||
      !/^\.control-retired-[a-f0-9-]{36}$/.test(swap.retired?.split('/').pop()) ||
      join(directory, swap.retired?.split('/').pop()) !== swap.retired
    )
      throw new QBError('RESTORE_INVALID', 'Invalid recovery swap journal', 409);
    if (!existsSync(swap.current) && existsSync(swap.retired))
      renameSync(swap.retired, swap.current);
    if (!existsSync(swap.current))
      throw new QBError('RESTORE_INVALID', 'Interrupted control restore requires recovery', 409);
    rmSync(swap.retired, { recursive: true, force: true });
    rmSync(journal, { force: true });
  }
  const folder = join(directory, 'backups', 'control');
  for (const [parent, pattern, directories] of [
    [folder, new RegExp('^\\.control-stage-' + uuid + '$'), true],
    [
      folder,
      new RegExp(
        '^' + archiveName + '\\.(?:sqlite|pglite\\.tar)(?:\\.enc\\.partial-' + uuid + ')?$',
      ),
      false,
    ],
    [directory, new RegExp('^\\.control-restore-' + uuid + '$'), true],
    [directory, new RegExp('^control\\.restore-' + uuid + '\\.sqlite(?:-wal|-shm)?$'), false],
  ] as const) {
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent)) {
      if (!pattern.test(name)) continue;
      const path = join(parent, name),
        info = lstatSync(path);
      if (!info.isSymbolicLink() && (directories ? info.isDirectory() : info.isFile()))
        rmSync(path, { recursive: directories, force: true });
    }
  }
}
function boundedOptions(options: ControlArchiveOptions) {
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
  )
    throw new QBError('VALIDATION', 'Invalid control archive byte limit');
  return {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(120000),
  };
}
export async function writeControlSnapshot(
  db: Database,
  directory: string,
  master: string,
  options: ControlArchiveOptions = {},
) {
  const bounded = boundedOptions(options);
  bounded.signal.throwIfAborted();
  if (activeSnapshots.has(db))
    throw new QBError('QUOTA', 'A control snapshot is already running', 429, true);
  activeSnapshots.add(db);
  let staging: string | undefined;
  try {
    const folder = join(directory, 'backups', 'control');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const estimatedSize = Number(
      (await db.query('SELECT pg_database_size(current_database()) AS bytes').get())!.bytes,
    );
    if (estimatedSize > (options.maxBytes ?? 1073741824))
      throw new QBError('SIZE_LIMIT', 'Control snapshot exceeds archive limit', 413);
    const disk = statfsSync(folder);
    if (disk.bavail * disk.bsize < 2 * estimatedSize + 67108864)
      throw new QBError(
        'DISK_PRESSURE',
        'Insufficient space for private control snapshot staging',
        503,
        true,
      );
    // UUID names give the restart sweeper an exact ownership namespace.
    staging = join(folder, '.control-stage-' + crypto.randomUUID());
    mkdirSync(staging, { mode: 0o700 });
    const temporary = join(staging, 'snapshot.pglite.tar');
    const id = new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID();
    const path = join(folder, id + '.pglite.tar.enc');
    await db.snapshot(temporary, options.maxBytes);
    chmodSync(temporary, 0o600);
    bounded.signal.throwIfAborted();
    const manifest = await encryptControlArchive(temporary, path, master, bounded);
    // Preserve the CLI's raw SHA-256 checksum contract; framing stores its algorithm prefix.
    return {
      path,
      checksum: manifest.checksum.slice('sha256:'.length),
      format: manifest.format,
      size: manifest.size,
    };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    activeSnapshots.delete(db);
  }
}
/** Offline recovery cannot revive revoked capabilities or replace missing project database files. */
export async function restoreControlSnapshot(
  directory: string,
  master: string,
  archive: string,
  options: ControlArchiveOptions = {},
) {
  const bounded = boundedOptions(options);
  bounded.signal.throwIfAborted();
  const release = acquireLease(directory);
  let staging: string | undefined;
  try {
    cleanupControlStaging(directory);
    // Conservative headroom for decrypted staging plus an encrypted rollback checkpoint.
    const currentBytes = databaseBytes(join(directory, 'control.pglite'));
    const disk = statfsSync(directory);
    if (disk.bavail * disk.bsize < statSync(archive).size + 2 * currentBytes + 67108864)
      throw new QBError(
        'DISK_PRESSURE',
        'Insufficient space for private control recovery staging',
        503,
        true,
      );
    staging = join(directory, '.control-restore-' + crypto.randomUUID());
    mkdirSync(staging, { mode: 0o700 });
    const snapshot = join(staging, 'control.snapshot');
    const temporary = join(staging, 'control.pglite');
    const manifest = await decryptControlArchive(archive, snapshot, master, bounded);
    bounded.signal.throwIfAborted();
    await restoreDatabase(snapshot, temporary);
    const restored = openDatabase(temporary, false);
    try {
      await restored.exec('SET CONSTRAINTS ALL IMMEDIATE');
      for (const branch of (await restored
        .query("SELECT id,project_id FROM branches WHERE status='ready'")
        .all()) as any[]) {
        const path = branchPath(directory, branch.project_id, branch.id);
        if (
          !existsSync(path) ||
          !statSync(path).isDirectory() ||
          !existsSync(join(path, 'PG_VERSION')) ||
          !existsSync(join(path, 'global', 'pg_control'))
        )
          throw new QBError(
            'RESTORE_DEPENDENCIES',
            'Restore all referenced project database files before the control catalog',
            409,
          );
      }
      for (const migration of (await restored
        .query('SELECT id,checksum FROM engine_migrations')
        .all()) as any[]) {
        if (!/^\d{3}-[a-z-]+$/.test(migration.id))
          throw new QBError('RESTORE_INVALID', 'Invalid control migration identifier', 409);
        let applied: Buffer;
        try {
          applied = readFileSync(
            new URL(`../../../migrations/pglite/${migration.id}.sql`, import.meta.url),
          );
        } catch {
          throw new QBError(
            'RESTORE_INVALID',
            'Control migration is unsupported by this runtime',
            409,
          );
        }
        if (checksum(applied) !== migration.checksum)
          throw new QBError('RESTORE_INVALID', 'Control migration checksum mismatch', 409);
      }
      await restored
        .transaction(async (tx) => {
          await tx.exec(
            'DELETE FROM _qb_auth_sessions;DELETE FROM _qb_auth_verifications;UPDATE management_tokens SET revoked_at=to_char(current_timestamp AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\');UPDATE project_keys SET revoked_at=to_char(current_timestamp AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\');UPDATE _qb_auth_accounts SET "accessToken"=NULL,"refreshToken"=NULL,"idToken"=NULL;',
          );
        })
        .immediate();
      await restored.exec('');
    } finally {
      await restored.close(true);
    }
    const current = join(directory, 'control.pglite');
    let rollback: string | undefined;
    if (existsSync(current)) {
      const previous = openDatabase(current, false);
      try {
        rollback = (await writeControlSnapshot(previous, directory, master, bounded)).path;
        await previous.exec('');
      } finally {
        await previous.close(true);
      }
    }
    bounded.signal.throwIfAborted();
    const retired = join(directory, '.control-retired-' + crypto.randomUUID());
    const journal = join(directory, '.control-swap.json');
    writeFileSync(journal, JSON.stringify({ current, temporary, retired }), { mode: 0o600 });
    const journalFd = openSync(journal, 'r');
    try {
      fsyncSync(journalFd);
    } finally {
      closeSync(journalFd);
    }
    if (existsSync(current)) await rename(current, retired);
    await rename(temporary, current);
    rmSync(retired, { recursive: true, force: true });
    rmSync(journal, { force: true });
    const parent = await open(directory, 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return {
      restored: true,
      rollback,
      platformSessionsExcluded: true,
      keysRevoked: true,
      format: manifest.format,
    };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    release();
  }
}
