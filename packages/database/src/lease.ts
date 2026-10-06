import { Database } from 'bun:sqlite';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { QBError } from '@qb-flex/contracts';
/** An OS-managed SQLite file lock fences one local API process. A crash releases the lock automatically. */
export function acquireLease(directory: string) {
  const database = new Database(join(directory, '.owner.sqlite'), { create: true });
  try {
    database.exec(
      'PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY);',
    );
  } catch {
    database.close();
    throw new QBError('OWNER_LOCK', 'Another API process owns this data directory', 503);
  }
  const path = join(directory, 'owner.lock'),
    nonce = crypto.randomUUID();
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, nonce }), { mode: 0o600 });
  } catch (error) {
    database.close();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (JSON.parse(readFileSync(path, 'utf8')).nonce === nonce) unlinkSync(path);
    } catch {}
    database.close();
  };
}
