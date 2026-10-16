import { dlopen, FFIType } from 'bun:ffi';
import { openSync, closeSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { QBError } from '@qb-flex/contracts';

// flock is released by the kernel on process death; a lockfile's age is never ownership evidence.
const libc = dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});
export function acquireLease(directory: string, marker = true) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fd = openSync(join(directory, '.owner.flock'), 'a', 0o600);
  if (libc.symbols.flock(fd, 2 | 4) !== 0) {
    closeSync(fd);
    throw new QBError('OWNER_LOCK', 'Another process owns this data directory', 503);
  }
  const path = join(directory, 'owner.lock'),
    nonce = crypto.randomUUID();
  try {
    if (marker) writeFileSync(path, JSON.stringify({ pid: process.pid, nonce }), { mode: 0o600 });
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (marker && JSON.parse(readFileSync(path, 'utf8')).nonce === nonce) unlinkSync(path);
    } catch {}
    closeSync(fd);
  };
}
