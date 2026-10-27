import { Database } from './connection';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { QBError } from '@qb-flex/contracts';
export { Database, restoreDatabase } from './connection';
export function openDatabase(path: string, _safeIntegers = true) {
  return new Database(path);
}
/** Exact-origin allowlist helper: trim entries and mirror localhost ↔ 127.0.0.1. */
export function normalizeOrigins(origins: Iterable<string>): string[] {
  const expanded = new Set<string>();
  for (const raw of origins) {
    const origin = raw.trim();
    if (!origin) continue;
    expanded.add(origin);
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1';
        expanded.add(url.origin);
      } else if (url.hostname === '127.0.0.1') {
        url.hostname = 'localhost';
        expanded.add(url.origin);
      }
    } catch {
      // Keep the exact configured value only when it is not a valid origin URL.
    }
  }
  return [...expanded];
}

export function configuration() {
  const dataDir = resolve(process.env.QB_DATA_DIR ?? '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let master = process.env.QB_MASTER_KEY;
  const secretPath = join(dataDir, 'master.key');
  if (!master) {
    if (process.env.NODE_ENV === 'production')
      throw new Error('QB_MASTER_KEY is required in production');
    if (!existsSync(secretPath))
      writeFileSync(secretPath, randomBytes(32).toString('hex'), { mode: 0o600 });
    master = readFileSync(secretPath, 'utf8').trim();
  }
  if (master.length < 32) throw new Error('QB_MASTER_KEY must contain at least 32 characters');
  const publicURL = process.env.QB_PUBLIC_URL ?? 'http://localhost:7612';
  if (process.env.NODE_ENV === 'production' && !publicURL.startsWith('https://')) {
    // Explicit opt-in for non-TLS local staging; public hosts must never use this path.
    let loopback = false;
    try {
      const host = new URL(publicURL).hostname;
      loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch {
      // Invalid URL falls through to the HTTPS requirement below.
    }
    if (process.env.QB_ALLOW_INSECURE_HTTP !== 'true' || !loopback)
      throw new Error(
        'Production requires HTTPS QB_PUBLIC_URL; local staging may set QB_ALLOW_INSECURE_HTTP=true with a loopback URL',
      );
  }
  const maxBranchOwners = Number(process.env.QB_MAX_BRANCH_OWNERS ?? 4);
  if (!Number.isInteger(maxBranchOwners) || maxBranchOwners < 1 || maxBranchOwners > 32)
    throw new Error('QB_MAX_BRANCH_OWNERS must be an integer from 1 to 32');
  return {
    maxBranchOwners,
    dataDir,
    master,
    publicURL,
    studioURL: process.env.QB_STUDIO_URL ?? 'http://localhost:7610',
    origins: normalizeOrigins(
      (
        process.env.QB_ALLOWED_ORIGINS ??
        'http://localhost:7610,http://localhost:7617,http://localhost:7618'
      ).split(','),
    ),
    port: Number(process.env.PORT ?? 7612),
  };
}
export function branchPath(dataDir: string, project: string, branch: string) {
  for (const id of [project, branch])
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new QBError('INVALID_ID', 'Invalid resource identifier');
  return join(dataDir, 'projects', project, 'branches', branch, 'main.pglite');
}
interface Pending {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class BranchOwner {
  private worker: Worker;
  private pending = new Map<string, Pending>();
  private ready: Promise<void>;
  private closed = false;
  private retiring = false;
  private closeTask?: Promise<void>;
  constructor(
    public path: string,
    options: Record<string, unknown>,
  ) {
    this.worker = new Worker(new URL('./owner.ts', import.meta.url).href);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail();
        reject(new QBError('OWNER_UNAVAILABLE', 'Owner startup timed out', 503, true));
      }, 15000);
      this.worker.addEventListener(
        'message',
        (e) => {
          if (e.data.ready) {
            clearTimeout(timer);
            resolve();
          }
          if (e.data.startupError) {
            clearTimeout(timer);
            this.fail();
            reject(new QBError('OWNER_UNAVAILABLE', 'Database owner could not start', 503, true));
          }
        },
        { once: true },
      );
    });
    this.worker.addEventListener('message', (e) => {
      const message = e.data;
      const job = this.pending.get(message.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.pending.delete(message.id);
      message.error
        ? job.reject(
            new QBError(
              message.error.code,
              message.error.message,
              message.error.status,
              message.error.retryable,
            ),
          )
        : job.resolve(message.result);
    });
    this.worker.addEventListener('error', () => this.fail());
    this.worker.postMessage({ init: { path, ...options } });
  }
  get available() {
    return !this.closed;
  }
  private fail() {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        new QBError(
          'OWNER_UNAVAILABLE',
          'Database owner stopped; reconcile the operation before retrying',
          503,
          true,
        ),
      );
    }
    this.pending.clear();
    this.worker.terminate();
  }
  async call(action: string, args: any = {}, timeout = 15000): Promise<any> {
    await this.ready;
    if (this.closed || (this.retiring && action !== 'close'))
      throw new QBError('OWNER_UNAVAILABLE', 'Database owner unavailable', 503, true);
    if (this.pending.size >= 64) throw new QBError('QUEUE_FULL', 'Branch queue is full', 503, true);
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, action, args });
    });
  }
  async close() {
    if (this.closeTask) return this.closeTask;
    if (this.closed) return;
    this.retiring = true;
    this.closeTask = (async () => {
      try {
        await this.call('close');
      } finally {
        this.closed = true;
        this.worker.terminate();
      }
    })();
    return this.closeTask;
  }
}
