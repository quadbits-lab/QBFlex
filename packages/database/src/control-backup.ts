import type { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encryption, realmSecret } from '@qb-flex/auth';
import { QBError } from '@qb-flex/contracts';
import { openDatabase, branchPath } from './index';
import { acquireLease } from './lease';
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function writeControlSnapshot(db: Database, directory: string, master: string) {
  const folder = join(directory, 'backups', 'control');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const id = new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID();
  const temporary = join(folder, id + '.sqlite'),
    path = temporary + '.enc';
  try {
    db.query('VACUUM INTO ?').run(temporary);
    const bytes = readFileSync(temporary),
      digest = checksum(bytes);
    writeFileSync(
      path,
      encryption(realmSecret(master, 'control-backups')).seal({
        format: 1,
        createdAt: new Date().toISOString(),
        checksum: digest,
        data: bytes.toString('base64'),
      }),
      { mode: 0o600 },
    );
    return { path, checksum: digest };
  } finally {
    rmSync(temporary, { force: true });
  }
}
/** Offline recovery cannot revive revoked capabilities or replace missing project database files. */
export function restoreControlSnapshot(directory: string, master: string, archive: string) {
  const release = acquireLease(directory),
    temporary = join(directory, 'control.restore-' + crypto.randomUUID() + '.sqlite');
  try {
    let envelope: any, bytes: Buffer;
    try {
      envelope = encryption(realmSecret(master, 'control-backups')).open(
        readFileSync(archive, 'utf8'),
      );
      bytes = Buffer.from(envelope.data, 'base64');
      if (envelope.format !== 1 || checksum(bytes) !== envelope.checksum) throw new Error();
    } catch {
      throw new QBError('BACKUP_CORRUPT', 'Control snapshot integrity validation failed', 409);
    }
    writeFileSync(temporary, bytes, { mode: 0o600 });
    const restored = openDatabase(temporary, false);
    try {
      if (
        (restored.query('PRAGMA integrity_check').get() as any).integrity_check !== 'ok' ||
        restored.query('PRAGMA foreign_key_check').all().length
      )
        throw new QBError('RESTORE_INVALID', 'Control database validation failed', 409);
      for (const branch of restored
        .query("SELECT id,project_id FROM branches WHERE status='ready'")
        .all() as any[])
        if (!existsSync(branchPath(directory, branch.project_id, branch.id)))
          throw new QBError(
            'RESTORE_DEPENDENCIES',
            'Restore all referenced project database files before the control catalog',
            409,
          );
      for (const migration of restored
        .query('SELECT id,checksum FROM control_migrations')
        .all() as any[])
        if (
          checksum(
            readFileSync(
              new URL(`../../../migrations/control/${migration.id}.sql`, import.meta.url),
            ),
          ) !== migration.checksum
        )
          throw new QBError('RESTORE_INVALID', 'Control migration checksum mismatch', 409);
      restored.exec(
        "DELETE FROM _qb_auth_sessions;DELETE FROM _qb_auth_verifications;UPDATE management_tokens SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');UPDATE project_keys SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');UPDATE _qb_auth_accounts SET accessToken=NULL,refreshToken=NULL,idToken=NULL;",
      );
      restored.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      restored.close(true);
    }
    const current = join(directory, 'control.sqlite');
    let rollback: string | undefined;
    if (existsSync(current)) {
      const previous = openDatabase(current, false);
      try {
        rollback = writeControlSnapshot(previous, directory, master).path;
        previous.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally {
        previous.close(true);
      }
    }
    rmSync(current + '-wal', { force: true });
    rmSync(current + '-shm', { force: true });
    renameSync(temporary, current);
    return { restored: true, rollback, platformSessionsExcluded: true, keysRevoked: true };
  } finally {
    rmSync(temporary, { force: true });
    rmSync(temporary + '-wal', { force: true });
    rmSync(temporary + '-shm', { force: true });
    release();
  }
}
