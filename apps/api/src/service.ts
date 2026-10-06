import { projectOpenAPI } from '../../../packages/contracts/src/openapi';
import { Elysia } from 'elysia';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  statSync,
  statfsSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
import { configuration, openDatabase, branchPath, BranchOwner } from '@qb-flex/database';
import { createRealm, realmSecret, encryption } from '@qb-flex/auth';
import { QBError, capabilities, routes, type Identity, type Role } from '@qb-flex/contracts';
import { normalize, cursorCodec } from '@qb-flex/query-engine';
import { ObjectBackend } from '@qb-flex/storage';
import { acquireLease } from '../../../packages/database/src/lease';
import { writeControlSnapshot } from '../../../packages/database/src/control-backup';
import { log, Metrics } from '@qb-flex/observability';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
export async function createService(override?: Partial<ReturnType<typeof configuration>>) {
  const config = { ...configuration(), ...override };
  const release = acquireLease(config.dataDir);
  try {
    const db = openDatabase(join(config.dataDir, 'control.sqlite'), false);
    const cipher = encryption(config.master);
    const platform = await createRealm(db, {
      secret: realmSecret(config.master, 'platform'),
      baseURL: config.publicURL,
      basePath: '/platform/auth',
      origins: [config.studioURL],
      platform: true,
    });
    for (const id of ['001-foundation', '002-credentials']) {
      const migration = readFileSync(
        new URL(`../../../migrations/control/${id}.sql`, import.meta.url),
        'utf8',
      );
      const checksum = sha(migration);
      const hasRegistry = db
        .query("SELECT 1 FROM sqlite_schema WHERE name='control_migrations'")
        .get();
      const existing = hasRegistry
        ? (db.query('SELECT checksum FROM control_migrations WHERE id=?').get(id) as any)
        : null;
      if (existing && existing.checksum !== checksum)
        throw new Error('Control migration checksum mismatch');
      if (!existing)
        db.transaction(() => {
          db.exec(migration);
          db.query('INSERT INTO control_migrations VALUES(?,?,?)').run(id, checksum, now());
        }).immediate();
    }
    const metrics = new Metrics();
    const starts = new WeakMap<Request, number>();
    const transfers = new WeakSet<Request>();
    let activeTransfers = 0,
      activeBackups = 0;
    function releaseTransfer(request: Request) {
      if (transfers.delete(request)) activeTransfers--;
    }
    const fenced = new Set<string>();
    const owners = new Map<string, BranchOwner>();
    const lastUsed = new Map<string, number>();
    const backend = new ObjectBackend();
    const timers = new Set<ReturnType<typeof setInterval>>();
    const bootstrapFile = join(config.dataDir, 'bootstrap.token');
    let bootstrap = process.env.QB_BOOTSTRAP_TOKEN;
    if (!bootstrap && !db.query('SELECT id FROM _qb_auth_users LIMIT 1').get()) {
      if (process.env.NODE_ENV === 'production')
        throw new Error('QB_BOOTSTRAP_TOKEN is required for first-owner setup');
      if (!existsSync(bootstrapFile))
        writeFileSync(bootstrapFile, randomBytes(32).toString('hex'), { mode: 0o600 });
      bootstrap = readFileSync(bootstrapFile, 'utf8').trim();
    }
    const success = (data: unknown, request: Request, meta: object = {}) => ({
      data: normalize(data),
      meta: { requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(), ...meta },
    });
    const managementCursor = cursorCodec(realmSecret(config.master, 'management-cursors'));
    function controlList(
      sql: string,
      values: unknown[],
      request: Request,
      scopeIdentity: string,
      key = 'id',
      descending = false,
      tie = key,
    ) {
      const url = new URL(request.url),
        limit = Number(url.searchParams.get('limit') ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new QBError('VALIDATION', 'List limit must be 1–500');
      const scope = sha(url.pathname + scopeIdentity + key + tie + descending);
      const cursor = url.searchParams.get('cursor');
      let after: any;
      if (cursor) {
        after = managementCursor.decode(cursor);
        if (after.scope !== scope)
          throw new QBError('INVALID_CURSOR', 'Management cursor belongs to another scope');
      }
      const direction = descending ? 'DESC' : 'ASC',
        comparison = descending ? '<' : '>';
      const rows = db
        .query(
          `SELECT * FROM (${sql}) ${after ? `WHERE ("${key}","${tie}") ${comparison} (?,?)` : ''} ORDER BY "${key}" ${direction},"${tie}" ${direction} LIMIT ?`,
        )
        .all(
          ...([...values, ...(after ? [after.key, after.tie] : []), limit + 1] as any[]),
        ) as any[];
      const data = rows.slice(0, limit),
        last = data.at(-1);
      return success(data, request, {
        cursor:
          rows.length > limit
            ? managementCursor.encode({ scope, key: last[key], tie: last[tie] })
            : undefined,
      });
    }
    const audit = (
      actor: string,
      action: string,
      resource: string,
      project: any,
      request: Request,
      result = 'success',
    ) =>
      db
        .query('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)')
        .run(
          crypto.randomUUID(),
          actor,
          project?.id ?? null,
          project?.org_id ?? null,
          action,
          resource,
          result,
          request.headers.get('x-request-id') ?? crypto.randomUUID(),
          now(),
        );
    async function user(request: Request) {
      const token = request.headers.get('authorization')?.replace(/^Bearer /i, '');
      if (token?.startsWith('qb_mt_')) {
        const row = db
          .query(
            'SELECT user_id FROM management_tokens WHERE hash=? AND revoked_at IS NULL AND expires_at>?',
          )
          .get(sha(token), now()) as any;
        if (row) {
          const scope = db
            .query(
              'SELECT definition FROM token_scopes WHERE token_id=(SELECT id FROM management_tokens WHERE hash=?)',
            )
            .get(sha(token)) as any;
          const resolvedScope = scope
            ? JSON.parse(scope.definition)
            : { readOnly: true, projects: [], organizations: [] };
          resolvedScope.organizations ??= [];
          const path = new URL(request.url).pathname;
          if (
            path.startsWith('/management/v1/invitations') ||
            path.startsWith('/management/v1/organizations/') ||
            path.startsWith('/management/v1/tokens') ||
            (path === '/management/v1/organizations' &&
              (request.method !== 'GET' || !resolvedScope.organizations.length))
          )
            throw new QBError(
              'TOKEN_SCOPE',
              'This management token does not grant organization administration',
              403,
            );
          return {
            id: row.user_id,
            tokenScope: resolvedScope,
          };
        }
      }
      const session = await platform.api.getSession({ headers: request.headers });
      if (!session) throw new QBError('UNAUTHORIZED', 'Sign in to QB Flex Studio', 401);
      return { ...session.user, tokenScope: null };
    }
    const ranks: Record<Role, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };
    function member(org: string, id: string, min: Role = 'viewer') {
      const row = db
        .query('SELECT role FROM memberships WHERE org_id=? AND user_id=?')
        .get(org, id) as any;
      if (!row || ranks[row.role as Role] < ranks[min])
        throw new QBError('DENIED', 'Organization permission required', 403);
      if (
        (process.env.QB_REQUIRE_ADMIN_MFA === 'true' ||
          (process.env.NODE_ENV === 'production' &&
            process.env.QB_REQUIRE_ADMIN_MFA !== 'false')) &&
        ranks[min] >= 1 &&
        ranks[row.role as Role] >= 2
      ) {
        const account = db
          .query('SELECT twoFactorEnabled FROM _qb_auth_users WHERE id=?')
          .get(id) as any;
        if (!account?.twoFactorEnabled)
          throw new QBError(
            'MFA_ENROLLMENT_REQUIRED',
            'Enroll administrator MFA in Studio Settings',
            403,
          );
      }
      return row;
    }
    async function projectAccess(request: Request, id: string, min: Role = 'viewer') {
      const actor = await user(request);
      if (request.method !== 'GET' && fenced.has(id))
        throw new QBError('OWNER_UNAVAILABLE', 'Branch cutover is in progress', 503, true);
      const p = db.query('SELECT * FROM projects WHERE id=?').get(id) as any;
      if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
      member(p.org_id, actor.id, min);
      if (
        actor.tokenScope &&
        ((!actor.tokenScope.projects.includes(id) &&
          !actor.tokenScope.organizations.includes(p.org_id)) ||
          (actor.tokenScope.readOnly && min !== 'viewer'))
      )
        throw new QBError('TOKEN_SCOPE', 'Management token does not grant this operation', 403);
      return { p, actor };
    }
    function branch(project: string, id: string) {
      const b = db
        .query('SELECT * FROM branches WHERE project_id=? AND (id=? OR name=?)')
        .get(project, id, id === 'primary' ? 'main' : id) as any;
      if (!b || b.status !== 'ready')
        throw new QBError('OWNER_UNAVAILABLE', 'Branch not ready', 503, true);
      return b;
    }
    function owner(p: any, b: any, touch = true) {
      if (touch) lastUsed.set(b.id, Date.now());
      let o = owners.get(b.id);
      if (o && !o.available) {
        owners.delete(b.id);
        o = undefined;
      }
      if (!o) {
        if (owners.size >= 32)
          throw new QBError('OWNER_LIMIT', 'Active branch limit reached', 503, true);
        const projectConfig = cipher.open(p.config);
        if (b.status === 'ready' && !existsSync(branchPath(config.dataDir, p.id, b.id)))
          throw new QBError(
            'OWNER_UNAVAILABLE',
            'Branch database file is missing; restore it before serving requests',
            503,
          );
        const secret = realmSecret(config.master, b.id);
        o = new BranchOwner(branchPath(config.dataDir, p.id, b.id), {
          secret,
          auth: {
            secret,
            baseURL: config.publicURL,
            basePath: `/v1/projects/${p.id}/branches/${b.id}/auth`,
            origins: projectConfig.origins ?? config.origins,
            verifyEmail: projectConfig.verifyEmail ?? false,
            providers: projectConfig.providers ?? {},
          },
        });
        owners.set(b.id, o);
      }
      return o;
    }
    async function application(request: Request, id: string, bid: string) {
      if (fenced.has(id))
        throw new QBError('OWNER_UNAVAILABLE', 'Branch cutover is in progress', 503, true);
      const p = db.query("SELECT * FROM projects WHERE id=? AND status='ready'").get(id) as any;
      if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
      const key = request.headers.get('x-qb-key');
      const credential = key
        ? (db
            .query(
              'SELECT id,scope FROM project_keys WHERE project_id=? AND hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',
            )
            .get(id, sha(key), now()) as any)
        : null;
      if (!credential || !['publishable', 'service'].includes(credential.scope))
        throw new QBError('UNAUTHORIZED', 'Valid project key required', 401);
      const settings = cipher.open(p.config);
      const origin = request.headers.get('origin');
      if (origin && !(settings.origins ?? config.origins).includes(origin))
        throw new QBError('DENIED', 'Origin not allowed for this project', 403);
      const b = branch(id, bid);
      const o = owner(p, b);
      if (
        request.method !== 'GET' &&
        /\/data\//.test(new URL(request.url).pathname) &&
        !new URL(request.url).pathname.endsWith('/query')
      ) {
        const file = branchPath(config.dataDir, p.id, b.id),
          bytes = [file, file + '-wal'].reduce(
            (sum, path) => sum + (existsSync(path) ? statSync(path).size : 0),
            0,
          );
        if (bytes >= (settings.quotas?.databaseBytes ?? 1073741824))
          throw new QBError('QUOTA', 'Branch database quota exceeded', 429);
      }
      let identity = await o.call('identity', { headers: [...request.headers.entries()] });
      if (
        request.headers.has('authorization') &&
        !identity &&
        !new URL(request.url).pathname.includes('/auth/')
      )
        throw new QBError('UNAUTHORIZED', 'Session expired or belongs to another realm', 401);
      let bypass = false;
      if (credential.scope === 'service') {
        if (request.headers.has('origin'))
          throw new QBError('DENIED', 'Service keys are server-only', 403);
        const record = db
          .query('SELECT definition FROM credential_scopes WHERE key_id=?')
          .get(credential.id) as any;
        const scope = record ? JSON.parse(record.definition) : null;
        const url = new URL(request.url);
        const resource = url.pathname.match(/\/data\/([^/]+)/)?.[1];
        if (
          !scope ||
          (scope.branch !== b.id && scope.branch !== 'primary') ||
          !resource ||
          !scope.tables.includes(resource) ||
          !scope.methods.includes(request.method)
        )
          throw new QBError('KEY_SCOPE', 'Service key does not grant this operation', 403);
        identity = { sub: credential.id, role: 'service' };
        bypass = scope.bypass === true;
        if (bypass) audit(credential.id, 'service.bypass', resource, p, request);
      }
      return {
        p,
        b,
        o,
        identity: (identity ?? { sub: null, role: 'anonymous' }) as Identity,
        privileged: bypass,
      };
    }
    async function management(request: Request, id: string, bid: string, min: Role = 'viewer') {
      const access = await projectAccess(request, id, min);
      if (request.method !== 'GET' && fenced.has(id))
        throw new QBError('OWNER_UNAVAILABLE', 'Branch cutover is in progress', 503, true);
      const b = branch(id, bid);
      return { ...access, b, o: owner(access.p, b) };
    }
    async function backup(p: any, b: any, actor: string, request: Request) {
      if (activeBackups >= 2)
        throw new QBError('BACKUP_BUSY', 'Backup capacity reached; retry later', 503, true);
      activeBackups++;
      try {
        const id = crypto.randomUUID();
        const raw = join(config.dataDir, 'backups', id + '.sqlite');
        await owner(p, b, false).call('snapshot', { path: raw }, 60000);
        const bytes = readFileSync(raw);
        const iv = randomBytes(12);
        const enc = createCipheriv(
          'aes-256-gcm',
          Buffer.from(realmSecret(config.master, 'backups'), 'hex'),
          iv,
        );
        const encrypted = Buffer.concat([iv, enc.update(bytes), enc.final(), enc.getAuthTag()]);
        const path = raw + '.enc';
        writeFileSync(path, encrypted, { mode: 0o600 });
        unlinkSync(raw);
        const info = await owner(p, b, false).call('schema', { privileged: true });
        db.query('INSERT INTO backups VALUES(?,?,?,?,?,?,?)').run(
          id,
          p.id,
          b.id,
          sha(bytes.toString('base64')),
          path,
          info.schemaVersion,
          now(),
        );
        audit(actor, 'backup.create', id, p, request);
        return { id, createdAt: now(), schemaVersion: info.schemaVersion };
      } finally {
        activeBackups--;
      }
    }
    // Single control-plane owner resumes pending provision operations after a restart.
    async function tick() {
      const operations = db
        .query(
          "SELECT o.*,p.config,p.org_id FROM operations o JOIN projects p ON p.id=o.project_id WHERE o.status IN('requested','running') AND o.type='provision' LIMIT 8",
        )
        .all() as any[];
      for (const operation of operations) {
        db.query("UPDATE operations SET status='running',progress=25 WHERE id=?").run(operation.id);
        try {
          const p = db.query('SELECT * FROM projects WHERE id=?').get(operation.project_id) as any;
          const b = db
            .query("SELECT * FROM branches WHERE project_id=? AND name='main'")
            .get(p.id) as any;
          await owner(p, b).call('schema', { privileged: true });
          db.transaction(() => {
            db.query("UPDATE branches SET status='ready' WHERE id=?").run(b.id);
            db.query("UPDATE projects SET status='ready' WHERE id=?").run(p.id);
            db.query("UPDATE operations SET status='succeeded',progress=100 WHERE id=?").run(
              operation.id,
            );
          })();
        } catch (error) {
          if (
            error instanceof QBError &&
            ['OWNER_LIMIT', 'OWNER_UNAVAILABLE', 'QUEUE_FULL'].includes(error.code)
          ) {
            db.query("UPDATE operations SET status='requested',progress=0 WHERE id=?").run(
              operation.id,
            );
            continue;
          }
          db.query("UPDATE operations SET status='failed',error=? WHERE id=?").run(
            'Provisioning failed; inspect operator logs',
            operation.id,
          );
          db.query("UPDATE projects SET status='failed' WHERE id=?").run(operation.project_id);
          db.query("UPDATE branches SET status='failed' WHERE project_id=?").run(
            operation.project_id,
          );
          log({ action: 'provision.failed' });
        }
      }
    }
    let ticking = false;
    const tickTimer = setInterval(() => {
      if (ticking) return;
      ticking = true;
      void tick().finally(() => (ticking = false));
    }, 1000);
    timers.add(tickTimer);
    let maintenanceBusy = false;
    const workerFile = join(config.dataDir, 'worker.token');
    let workerToken = process.env.QB_WORKER_TOKEN;
    if (!workerToken) {
      if (process.env.NODE_ENV === 'production')
        throw new Error('QB_WORKER_TOKEN is required in production');
      if (!existsSync(workerFile))
        writeFileSync(workerFile, randomBytes(32).toString('hex'), { mode: 0o600 });
      workerToken = readFileSync(workerFile, 'utf8').trim();
    }
    function internal(request: Request) {
      const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      if (
        supplied.length !== workerToken!.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(workerToken!))
      )
        throw new QBError('UNAUTHORIZED', 'Worker authentication required', 401);
    }
    async function maintain() {
      if (maintenanceBusy) return { running: true };
      maintenanceBusy = true;
      let cleaned = 0,
        backedUp = 0;
      try {
        const request = new Request(config.publicURL + '/internal/maintenance');
        const branches = db
          .query(
            "SELECT b.*,p.org_id,p.config FROM branches b JOIN projects p ON p.id=b.project_id WHERE b.status='ready' AND p.status='ready'",
          )
          .all() as any[];
        for (const b of branches) {
          const p = db.query('SELECT * FROM projects WHERE id=?').get(b.project_id) as any;
          const existing = owners.has(b.id);
          if (!existing && owners.size >= 32) continue;
          const o = owner(p, b, false);
          try {
            await o.call('cleanup');
            cleaned++;
            const pending = await o.call('object-maintenance');
            for (const object of pending) {
              try {
                await backend.delete(`${p.id}/${b.id}/${object.id}`);
                await o.call('object-state', { id: object.id, state: 'deleted' });
              } catch {
                log({ action: 'storage.cleanup.failed' });
              }
            }
            if (b.name === 'main' && process.env.QB_SCHEDULED_BACKUPS !== 'false') {
              const latest = db
                .query(
                  'SELECT created_at FROM backups WHERE branch_id=? ORDER BY created_at DESC LIMIT 1',
                )
                .get(b.id) as any;
              if (!latest || Date.parse(latest.created_at) < Date.now() - 86400000) {
                await backup(p, b, 'system', request);
                backedUp++;
              }
            }
          } finally {
            if (!existing) {
              await o.close();
              owners.delete(b.id);
              lastUsed.delete(b.id);
            }
          }
        }
        const dailyDays = Math.max(
            1,
            Math.min(365, Number(process.env.QB_BACKUP_RETENTION_DAYS ?? 7)),
          ),
          weeklyCopies = Math.max(
            0,
            Math.min(52, Number(process.env.QB_BACKUP_RETENTION_WEEKS ?? 4)),
          );
        const retainedWeeks = new Map<string, Set<number>>();
        for (const record of db
          .query(
            'SELECT id,path,branch_id,created_at FROM backups ORDER BY created_at DESC,id DESC',
          )
          .all() as any[]) {
          const age = Date.now() - Date.parse(record.created_at),
            week = Math.floor(Date.parse(record.created_at) / (7 * 86400000));
          const weeks = retainedWeeks.get(record.branch_id) ?? new Set<number>();
          retainedWeeks.set(record.branch_id, weeks);
          const weekly =
            !weeks.has(week) &&
            weeks.size < weeklyCopies &&
            age < (weeklyCopies + 1) * 7 * 86400000;
          if (weekly) weeks.add(week);
          if (age < dailyDays * 86400000 || weekly) continue;
          rmSync(record.path, { force: true });
          db.query('DELETE FROM backups WHERE id=?').run(record.id);
        }
        if (process.env.QB_SCHEDULED_BACKUPS !== 'false') {
          const folder = join(config.dataDir, 'backups', 'control');
          mkdirSync(folder, { recursive: true, mode: 0o700 });
          const files = readdirSync(folder)
            .filter((name) => name.endsWith('.sqlite.enc'))
            .sort()
            .reverse();
          if (!files.some((name) => name.startsWith(now().slice(0, 10))))
            writeControlSnapshot(db, config.dataDir, config.master);
          const weeks = new Set<number>();
          for (const name of files) {
            const timestamp = statSync(join(folder, name)).mtimeMs,
              age = Date.now() - timestamp,
              week = Math.floor(timestamp / (7 * 86400000));
            const weekly =
              !weeks.has(week) &&
              weeks.size < weeklyCopies &&
              age < (weeklyCopies + 1) * 7 * 86400000;
            if (weekly) weeks.add(week);
            if (age >= dailyDays * 86400000 && !weekly) rmSync(join(folder, name), { force: true });
          }
        }
        db.query('DELETE FROM audit_events WHERE time<?').run(
          new Date(Date.now() - 90 * 86400000).toISOString(),
        );
        for (const [id, time] of lastUsed)
          if (time < Date.now() - 600000) {
            await owners.get(id)?.close();
            owners.delete(id);
            lastUsed.delete(id);
          }
        return { cleaned, backedUp };
      } finally {
        maintenanceBusy = false;
      }
    }
    let setupBusy = false;
    const limits = new Map<string, { count: number; reset: number }>();
    const app = new Elysia({ serve: { maxRequestBodySize: 104857600 } })
      .onRequest(({ request, set }) => {
        starts.set(request, performance.now());
        set.headers['x-request-id'] =
          request.headers.get('x-request-id')?.slice(0, 100) ?? crypto.randomUUID();
        const origin = request.headers.get('origin');
        const path = new URL(request.url).pathname;
        let allowed = config.origins;
        let requestLimit = 600;
        const projectId = path.match(/^\/v1\/projects\/([^/]+)/)?.[1];
        if (projectId) {
          const project = db.query('SELECT config FROM projects WHERE id=?').get(projectId) as any;
          if (project) {
            const settings = cipher.open(project.config);
            allowed = settings.origins ?? allowed;
            requestLimit = settings.quotas?.requestsPerMinute ?? 600;
          }
        }
        if (origin) {
          if (!allowed.includes(origin)) throw new QBError('DENIED', 'Origin is not allowed', 403);
          set.headers['Vary'] = 'Origin';
          if (allowed.includes(origin)) {
            set.headers['Access-Control-Allow-Origin'] = origin;
            set.headers['Access-Control-Allow-Credentials'] = 'true';
            set.headers['Access-Control-Expose-Headers'] = 'set-auth-token,x-request-id';
          }
        }
        const length = Number(request.headers.get('content-length') ?? 0);
        if (length > 65536 && !(request.method === 'PUT' && path.endsWith('/content')))
          throw new QBError('SIZE_LIMIT', 'JSON request bodies are limited to 64 KiB', 413);
        if (request.method === 'OPTIONS') {
          set.headers['Access-Control-Allow-Headers'] =
            'Content-Type,Authorization,X-QB-Key,X-Request-ID,Idempotency-Key,If-Match';
          set.headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,PUT,DELETE,OPTIONS';
          set.status = 204;
          return '';
        }
        const key =
          request.headers.get('x-qb-key') ?? request.headers.get('authorization') ?? 'anonymous';
        const bucket = limits.get(sha(key));
        if (!bucket || bucket.reset < Date.now())
          limits.set(sha(key), { count: 1, reset: Date.now() + 60000 });
        else if (++bucket.count > requestLimit)
          throw new QBError('QUOTA', 'Request quota exceeded', 429, true);
        if (limits.size > 10000) {
          for (const [k, v] of limits) if (v.reset < Date.now()) limits.delete(k);
          if (limits.size > 10000) {
            limits.delete(sha(key));
            throw new QBError('QUOTA', 'Credential rate-limit capacity reached', 429, true);
          }
        }
        if (request.method === 'PUT' && path.endsWith('/content')) {
          if (activeTransfers >= 4)
            throw new QBError('TRANSFER_BUSY', 'Upload capacity reached; retry later', 503, true);
          activeTransfers++;
          transfers.add(request);
        }
      })
      .onAfterHandle(({ request, set }) => {
        releaseTransfer(request);
        const durationMs = performance.now() - (starts.get(request) ?? performance.now());
        const status = typeof set.status === 'number' ? set.status : 200;
        const path = new URL(request.url).pathname;
        metrics.record(request.method, path, status, durationMs);
        if (!['/health', '/ready'].includes(path))
          log({
            requestId: String(set.headers['x-request-id']),
            method: request.method,
            path,
            status,
            durationMs: Math.round(durationMs * 100) / 100,
          });
      })
      .onError(({ error, set, request }) => {
        releaseTransfer(request);
        const known = error instanceof QBError;
        const validation =
          ('code' in error &&
            ['VALIDATION', 'PARSE', 'INVALID_COOKIE_SIGNATURE'].includes(String(error.code))) ||
          error instanceof SyntaxError;
        const status = known ? error.status : validation ? 400 : 500;
        set.status = status;
        metrics.record(
          request.method,
          new URL(request.url).pathname,
          status,
          performance.now() - (starts.get(request) ?? performance.now()),
        );
        log({
          requestId: request.headers.get('x-request-id') ?? undefined,
          method: request.method,
          path: new URL(request.url).pathname,
          status,
          code: known ? error.code : 'INTERNAL',
        });
        return {
          error: {
            code: known ? error.code : validation ? 'VALIDATION' : 'INTERNAL',
            message: known
              ? error.message
              : validation
                ? 'Invalid request body or query'
                : 'The operation could not be completed',
            requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
            retryable: known ? error.retryable : false,
          },
        };
      })
      .get('/health', () => ({ status: 'ok' }))
      .get('/ready', () => {
        db.query('SELECT 1').get();
        const disk = statfsSync(config.dataDir);
        if (disk.bavail * disk.bsize < Number(process.env.QB_MIN_DISK_BYTES ?? 67108864))
          throw new QBError(
            'DISK_PRESSURE',
            'Available disk space below readiness threshold',
            503,
            true,
          );
        return { status: 'ready', owners: owners.size };
      })
      .post('/internal/maintenance', async ({ request }) => {
        internal(request);
        return success(await maintain(), request);
      })
      .get('/internal/metrics', ({ request }) => {
        internal(request);
        const disk = statfsSync(config.dataDir);
        return new Response(
          metrics.render({
            active_owners: owners.size,
            disk_available_bytes: disk.bavail * disk.bsize,
          }),
          { headers: { 'content-type': 'text/plain; version=0.0.4' } },
        );
      })
      .get('/setup', ({ request }) =>
        success({ required: !db.query('SELECT id FROM _qb_auth_users LIMIT 1').get() }, request),
      )
      .post('/setup', async ({ body, request }) => {
        const input = body as any;
        const supplied = String(input.bootstrapToken ?? '');
        if (
          !bootstrap ||
          supplied.length !== bootstrap.length ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(bootstrap))
        )
          throw new QBError('DENIED', 'Valid bootstrap token required', 403);
        if (setupBusy || db.query('SELECT id FROM _qb_auth_users LIMIT 1').get())
          throw new QBError('SETUP_COMPLETE', 'First owner is already configured', 409);
        setupBusy = true;
        try {
          const result = await platform.api.signUpEmail({
            body: { email: input.email, password: input.password, name: input.name },
          });
          const id = crypto.randomUUID();
          db.transaction(() => {
            db.query('INSERT INTO organizations VALUES(?,?,?)').run(
              id,
              input.organization ?? 'Personal workspace',
              now(),
            );
            db.query('INSERT INTO memberships VALUES(?,?,?)').run(id, result.user.id, 'owner');
          })();
          bootstrap = undefined;
          if (existsSync(bootstrapFile)) unlinkSync(bootstrapFile);
          return success({ organizationId: id }, request);
        } finally {
          setupBusy = false;
        }
      })
      .all('/platform/auth/*', async ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.includes('/sign-up'))
          throw new QBError(
            'DENIED',
            'Platform registration requires first-owner setup or invitation',
            403,
          );
        const before = path.endsWith('/two-factor/verify-totp')
          ? await platform.api.getSession({ headers: request.headers })
          : null;
        const response = await platform.handler(request);
        if (
          before &&
          response.ok &&
          path.endsWith('/two-factor/verify-totp') &&
          (await response.clone().json()).status !== false
        ) {
          const account = db
            .query('SELECT twoFactorEnabled FROM _qb_auth_users WHERE id=?')
            .get(before.user.id) as any;
          if (account?.twoFactorEnabled) {
            const newToken = response.headers.get('set-auth-token');
            if (newToken)
              db.query('DELETE FROM _qb_auth_sessions WHERE userId=? AND token<>?').run(
                before.user.id,
                newToken,
              );
            db.query(
              'UPDATE management_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
            ).run(now(), before.user.id);
          }
        }
        return response;
      })
      .get('/management/v1/capabilities', ({ request }) =>
        success(
          { ...capabilities, storage: process.env.QB_S3_ENDPOINT ? 'available' : 'unconfigured' },
          request,
        ),
      )
      .get('/management/v1/organizations', async ({ request }) => {
        const actor = await user(request);
        const scope = actor.tokenScope?.organizations as string[] | undefined;
        return controlList(
          `SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=?${scope ? ` AND o.id IN(${scope.map(() => '?').join(',') || 'NULL'})` : ''}`,
          [actor.id, ...(scope ?? [])],
          request,
          actor.id + JSON.stringify(scope),
        );
      })
      .post('/management/v1/organizations', async ({ request, body }) => {
        const actor = await user(request);
        if (actor.tokenScope)
          throw new QBError('TOKEN_SCOPE', 'Use a platform session to create organizations', 403);
        if (
          (process.env.QB_REQUIRE_ADMIN_MFA === 'true' ||
            (process.env.NODE_ENV === 'production' &&
              process.env.QB_REQUIRE_ADMIN_MFA !== 'false')) &&
          !(db.query('SELECT twoFactorEnabled FROM _qb_auth_users WHERE id=?').get(actor.id) as any)
            ?.twoFactorEnabled
        )
          throw new QBError(
            'MFA_ENROLLMENT_REQUIRED',
            'Enroll administrator MFA in Studio Settings',
            403,
          );
        const name = String((body as any).name ?? '').trim();
        if (!name || name.length > 100)
          throw new QBError('VALIDATION', 'Organization name required');
        const id = crypto.randomUUID();
        db.transaction(() => {
          db.query('INSERT INTO organizations VALUES(?,?,?)').run(id, name, now());
          db.query('INSERT INTO memberships VALUES(?,?,?)').run(id, actor.id, 'owner');
        })();
        audit(actor.id, 'organization.create', id, { org_id: id }, request);
        return success({ id, name }, request);
      })
      .get('/management/v1/organizations/:id/members', async ({ params, request }) => {
        const actor = await user(request);
        member(params.id, actor.id);
        return success(
          db
            .query(
              'SELECT m.user_id,m.role,u.email,u.name FROM memberships m JOIN _qb_auth_users u ON u.id=m.user_id WHERE m.org_id=?',
            )
            .all(params.id),
          request,
        );
      })
      .post('/management/v1/organizations/:id/members', async ({ params, request, body }) => {
        const actor = await user(request);
        member(params.id, actor.id, 'admin');
        const input = body as any;
        if (!['admin', 'developer', 'viewer'].includes(input.role))
          throw new QBError('VALIDATION', 'Invalid member role');
        const account = db
          .query('SELECT id FROM _qb_auth_users WHERE email=?')
          .get(input.email) as any;
        if (!account)
          throw new QBError('NOT_FOUND', 'Create the invited platform account first', 404);
        const existingRole = db
          .query('SELECT role FROM memberships WHERE org_id=? AND user_id=?')
          .get(params.id, account.id) as any;
        if (existingRole?.role === 'owner')
          throw new QBError(
            'DENIED',
            'Ownership transfer requires an explicit owner workflow',
            403,
          );
        db.query(
          'INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role',
        ).run(params.id, account.id, input.role);
        audit(actor.id, 'membership.update', account.id, { org_id: params.id }, request);
        return success({ userId: account.id, role: input.role }, request);
      })
      .post('/management/v1/invitations', async ({ request, body }) => {
        const actor = await user(request);
        const input = body as any;
        member(input.organizationId, actor.id, 'admin');
        const account = await platform.api.signUpEmail({
          body: { name: input.name, email: input.email, password: input.temporaryPassword },
        });
        db.query('INSERT INTO memberships VALUES(?,?,?)').run(
          input.organizationId,
          account.user.id,
          ['admin', 'developer', 'viewer'].includes(input.role) ? input.role : 'viewer',
        );
        audit(
          actor.id,
          'membership.invite',
          account.user.id,
          { org_id: input.organizationId },
          request,
        );
        return success({ userId: account.user.id }, request);
      })
      .post('/management/v1/tokens', async ({ request, body }) => {
        const actor = await user(request);
        if (actor.tokenScope)
          throw new QBError('DENIED', 'Sign in with a platform session to create tokens', 403);
        const input = body as any;
        const organizations = Array.isArray(input?.organizations) ? input.organizations : [];
        if (organizations.length > 100)
          throw new QBError('VALIDATION', 'Too many organization scopes');
        for (const org of organizations)
          member(org, actor.id, input?.readOnly ? 'viewer' : 'developer');
        const projects = Array.isArray(input?.projects)
          ? input.projects
          : db
              .query(
                'SELECT p.id FROM projects p JOIN memberships m ON m.org_id=p.org_id WHERE m.user_id=?',
              )
              .all(actor.id)
              .map((p: any) => p.id);
        for (const id of projects)
          await projectAccess(request, id, input?.readOnly ? 'viewer' : 'developer');
        const token = 'qb_mt_' + randomBytes(32).toString('base64url');
        const id = crypto.randomUUID();
        db.transaction(() => {
          db.query('INSERT INTO management_tokens VALUES(?,?,?,?,NULL)').run(
            id,
            actor.id,
            sha(token),
            new Date(Date.now() + 86400000 * 30).toISOString(),
          );
          db.query('INSERT INTO token_scopes VALUES(?,?)').run(
            id,
            JSON.stringify({ projects, organizations, readOnly: input?.readOnly === true }),
          );
        })();
        audit(actor.id, 'management-token.create', id, null, request);
        return success({ id, token, projects, organizations }, request);
      })
      .get('/management/v1/tokens', async ({ request }) => {
        const actor = await user(request);
        return success(
          db
            .query('SELECT id,expires_at,revoked_at FROM management_tokens WHERE user_id=?')
            .all(actor.id),
          request,
        );
      })
      .delete('/management/v1/tokens/:token', async ({ request, params }) => {
        const actor = await user(request);
        db.query('UPDATE management_tokens SET revoked_at=? WHERE id=? AND user_id=?').run(
          now(),
          params.token,
          actor.id,
        );
        return success({ revoked: true }, request);
      })
      .get('/management/v1/projects', async ({ request }) => {
        const actor = await user(request);
        const scope = actor.tokenScope?.projects as string[] | undefined;
        return controlList(
          `SELECT p.id,p.org_id,p.name,p.slug,p.status,p.region,p.created_at FROM projects p JOIN memberships m ON m.org_id=p.org_id WHERE m.user_id=?${scope ? ` AND (p.id IN(${scope.map(() => '?').join(',') || 'NULL'}) OR p.org_id IN(${(actor.tokenScope.organizations as string[]).map(() => '?').join(',') || 'NULL'}))` : ''}`,
          [actor.id, ...(scope ?? []), ...(actor.tokenScope?.organizations ?? [])],
          request,
          actor.id + JSON.stringify(actor.tokenScope),
          'created_at',
          true,
          'id',
        );
      })
      .post('/management/v1/projects', async ({ request, body, set }) => {
        const actor = await user(request);
        const input = body as any;
        if (
          actor.tokenScope &&
          (actor.tokenScope.readOnly ||
            !actor.tokenScope.organizations.includes(input.organizationId))
        )
          throw new QBError(
            'TOKEN_SCOPE',
            'Token requires an explicit writable organization scope',
            403,
          );
        member(input.organizationId, actor.id, 'developer');
        if (
          !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug) ||
          !input.name ||
          (input.region && input.region !== 'local')
        )
          throw new QBError('VALIDATION', 'Name, valid slug and local region required');
        const idem = request.headers.get('idempotency-key');
        const scope = idem ? sha(actor.id + input.organizationId + idem) : null;
        const digest = sha(JSON.stringify(input));
        if (scope) {
          const old = db
            .query('SELECT * FROM management_idempotency WHERE scope=?')
            .get(scope) as any;
          if (old) {
            if (old.hash !== digest)
              throw new QBError('IDEMPOTENCY_CONFLICT', 'Idempotency key changed', 409);
            set.status = 202;
            return success(JSON.parse(old.response), request);
          }
        }
        const id = crypto.randomUUID(),
          bid = crypto.randomUUID(),
          operationId = crypto.randomUUID();
        const result = { id, branchId: bid, operationId };
        db.transaction(() => {
          db.query('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)').run(
            id,
            input.organizationId,
            input.name,
            input.slug,
            'provisioning',
            'local',
            cipher.seal({ origins: config.origins, providers: {}, verifyEmail: false }),
            now(),
          );
          db.query('INSERT INTO branches VALUES(?,?,?,?,?,?)').run(
            bid,
            id,
            'main',
            'provisioning',
            1,
            now(),
          );
          db.query('INSERT INTO operations VALUES(?,?,?,?,?,?,?)').run(
            operationId,
            id,
            'provision',
            'requested',
            0,
            null,
            now(),
          );
          if (scope)
            db.query('INSERT INTO management_idempotency VALUES(?,?,?)').run(
              scope,
              digest,
              JSON.stringify(result),
            );
        })();
        audit(actor.id, 'project.create', id, { id, org_id: input.organizationId }, request);
        set.status = 202;
        return success(result, request);
      })
      .get('/management/v1/operations/:id', async ({ request, params }) => {
        const row = db.query('SELECT * FROM operations WHERE id=?').get(params.id) as any;
        if (!row) throw new QBError('NOT_FOUND', 'Operation not available', 404);
        await projectAccess(request, row.project_id);
        return success(row, request);
      })
      .post('/management/v1/operations/:id/cancel', async ({ request, params }) => {
        const operation = db.query('SELECT * FROM operations WHERE id=?').get(params.id) as any;
        if (!operation) throw new QBError('NOT_FOUND', 'Operation not available', 404);
        const { p, actor } = await projectAccess(request, operation.project_id, 'developer');
        if (operation.status === 'cancelled') return success(operation, request);
        if (operation.status !== 'requested')
          throw new QBError(
            'OPERATION_NOT_CANCELLABLE',
            'Only provisioning operations that have not started can be cancelled',
            409,
          );
        db.transaction(() => {
          db.query(
            "UPDATE operations SET status='cancelled' WHERE id=? AND status='requested'",
          ).run(operation.id);
          db.query("UPDATE projects SET status='cancelled' WHERE id=?").run(p.id);
          db.query("UPDATE branches SET status='cancelled' WHERE project_id=?").run(p.id);
        })();
        audit(actor.id, 'operation.cancel', operation.id, p, request);
        return success({ id: operation.id, status: 'cancelled' }, request);
      })
      .get('/management/v1/projects/:id/branches', async ({ request, params }) => {
        const { actor } = await projectAccess(request, params.id);
        return controlList(
          'SELECT * FROM branches WHERE project_id=?',
          [params.id],
          request,
          actor.id,
        );
      })
      .get('/management/v1/projects/:id/keys', async ({ request, params }) => {
        const { actor } = await projectAccess(request, params.id);
        return controlList(
          'SELECT id,scope,prefix,expires_at,revoked_at FROM project_keys WHERE project_id=?',
          [params.id],
          request,
          actor.id,
        );
      })
      .post('/management/v1/projects/:id/keys', async ({ request, params, body }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        const input = body as any;
        const scope = input?.scope ?? 'publishable';
        if (!['publishable', 'service'].includes(scope))
          throw new QBError('VALIDATION', 'Invalid key scope');
        if (
          scope === 'service' &&
          (!Array.isArray(input.tables) ||
            !input.tables.length ||
            !Array.isArray(input.methods) ||
            input.methods.some((m: string) => !['GET', 'POST', 'PATCH', 'DELETE'].includes(m)) ||
            !input.branch)
        )
          throw new QBError('VALIDATION', 'Service keys require branch, tables and methods');
        const key =
          (scope === 'service' ? 'qb_sk_' : 'qb_pk_') + randomBytes(32).toString('base64url');
        const id = crypto.randomUUID();
        db.query('INSERT INTO project_keys VALUES(?,?,?,?,?,?,NULL)').run(
          id,
          p.id,
          scope,
          sha(key),
          key.slice(0, 15),
          input?.expiresAt ?? null,
        );
        if (scope === 'service')
          db.query('INSERT INTO credential_scopes VALUES(?,?)').run(
            id,
            JSON.stringify({
              branch: input.branch,
              tables: input.tables,
              methods: input.methods,
              bypass: input.bypass === true,
            }),
          );
        audit(actor.id, 'key.create', id, p, request);
        return success({ id, key }, request);
      })
      .delete('/management/v1/projects/:id/keys/:key', async ({ request, params }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        db.query('UPDATE project_keys SET revoked_at=? WHERE id=? AND project_id=?').run(
          now(),
          params.key,
          p.id,
        );
        audit(actor.id, 'key.revoke', params.key, p, request);
        return success({ revoked: true }, request);
      })
      .get('/management/v1/projects/:id/config', async ({ request, params }) => {
        const { p } = await projectAccess(request, params.id);
        const c = cipher.open(p.config);
        return success(
          {
            origins: c.origins,
            verifyEmail: c.verifyEmail,
            quotas: c.quotas ?? {
              databaseBytes: 1073741824,
              storageBytes: 1073741824,
              requestsPerMinute: 600,
            },
            providers: Object.keys(c.providers ?? {}),
            version: Number(
              (
                db
                  .query('SELECT version FROM project_config_versions WHERE project_id=?')
                  .get(p.id) as any
              )?.version ?? 1,
            ),
          },
          request,
        );
      })
      .put('/management/v1/projects/:id/config', async ({ request, params, body }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        const input = body as any;
        const old = cipher.open(p.config);
        const version = Number(
          (
            db
              .query('SELECT version FROM project_config_versions WHERE project_id=?')
              .get(p.id) as any
          )?.version ?? 1,
        );
        if (Number(request.headers.get('if-match')) !== version)
          throw new QBError(
            'CONFIG_CONFLICT',
            'Refresh config and send its version in If-Match',
            409,
          );
        if (input.verifyEmail !== undefined && typeof input.verifyEmail !== 'boolean')
          throw new QBError('VALIDATION', 'verifyEmail must be a boolean');
        if (
          input.providers &&
          (typeof input.providers !== 'object' ||
            Object.entries(input.providers).some(
              ([name, value]: [string, any]) =>
                !['google', 'github'].includes(name) ||
                typeof value.clientId !== 'string' ||
                typeof value.clientSecret !== 'string' ||
                value.clientId.length > 4096 ||
                value.clientSecret.length > 4096,
            ))
        )
          throw new QBError(
            'VALIDATION',
            'Google and GitHub credentials require string clientId and clientSecret',
          );
        if (
          input.origins &&
          (!Array.isArray(input.origins) ||
            input.origins.some((o: string) => {
              try {
                return new URL(o).origin !== o;
              } catch {
                return true;
              }
            }))
        )
          throw new QBError('VALIDATION', 'Provide exact origin URLs');
        if (
          input.quotas &&
          (typeof input.quotas !== 'object' ||
            Object.entries(input.quotas).some(
              ([name, value]) =>
                !['databaseBytes', 'storageBytes', 'requestsPerMinute'].includes(name) ||
                !Number.isSafeInteger(value) ||
                Number(value) < 1 ||
                Number(value) > 1099511627776,
            ))
        )
          throw new QBError(
            'VALIDATION',
            'Quotas require positive integer databaseBytes, storageBytes or requestsPerMinute',
          );
        const next = {
          ...old,
          origins: input.origins ?? old.origins,
          verifyEmail: input.verifyEmail ?? old.verifyEmail,
          quotas: { ...old.quotas, ...input.quotas },
          providers: { ...old.providers, ...input.providers },
        };
        db.transaction(() => {
          db.query('UPDATE projects SET config=? WHERE id=?').run(cipher.seal(next), p.id);
          db.query(
            'INSERT INTO project_config_versions VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET version=excluded.version',
          ).run(p.id, version + 1);
        })();
        for (const b of db.query('SELECT id FROM branches WHERE project_id=?').all(p.id) as any[])
          if (owners.has(b.id)) {
            await owners.get(b.id)!.close();
            owners.delete(b.id);
          }
        audit(actor.id, 'config.update', p.id, p, request);
        return success({ updated: true, version: version + 1 }, request);
      })
      .put('/management/v1/projects/:id/secrets/:name', async ({ request, params, body }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(params.name) || typeof (body as any).value !== 'string')
          throw new QBError('VALIDATION', 'Provide an uppercase secret name and string value');
        const id = crypto.randomUUID();
        db.query('INSERT INTO secret_versions VALUES(?,?,?,?,?)').run(
          id,
          p.id,
          params.name,
          cipher.seal({ value: (body as any).value }),
          now(),
        );
        audit(actor.id, 'secret.rotate', params.name, p, request);
        return success({ id, name: params.name }, request);
      })
      .get('/management/v1/projects/:id/secrets', async ({ request, params }) => {
        await projectAccess(request, params.id, 'admin');
        return success(
          db
            .query(
              'SELECT name,MAX(created_at) AS updatedAt FROM secret_versions WHERE project_id=? GROUP BY name',
            )
            .all(params.id),
          request,
        );
      })
      .get('/management/v1/projects/:id/branches/:branch/schema', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch);
        return success(await o.call('schema', { privileged: true }), request);
      })
      .get(
        '/management/v1/projects/:id/branches/:branch/data/:table',
        async ({ request, params, query }) => {
          const { o } = await management(request, params.id, params.branch);
          const r = await o.call('read', {
            table: params.table,
            query: {
              limit: Number(query.limit ?? 50),
              cursor: query.cursor,
              count: true,
              filters: query.filters ? JSON.parse(query.filters) : [],
              order: query.order ? JSON.parse(query.order) : [],
            },
            privileged: true,
          });
          return success(r.data, request, r.meta);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/data/:table',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const r = await o.call('mutate', {
            table: params.table,
            method: 'insert',
            input: body,
            privileged: true,
            idempotency: request.headers.get('idempotency-key'),
          });
          audit(actor.id, 'row.insert', params.table, p, request);
          return success(r.data, request, r.meta);
        },
      )
      .patch(
        '/management/v1/projects/:id/branches/:branch/data/:table/:key',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const r = await o.call('mutate', {
            table: params.table,
            method: 'update',
            input: body,
            key: params.key,
            privileged: true,
          });
          audit(actor.id, 'row.update', params.table, p, request);
          return success(r.data, request, r.meta);
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/data/:table/:key',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const r = await o.call('mutate', {
            table: params.table,
            method: 'delete',
            key: params.key,
            privileged: true,
          });
          audit(actor.id, 'row.delete', params.table, p, request);
          return success(r.data, request, r.meta);
        },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/migrations',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(await o.call('migrations'), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/migrations',
        async ({ request, params, body }) => {
          const { o, p, b, actor } = await management(
            request,
            params.id,
            params.branch,
            'developer',
          );
          const input = body as any;
          if (/\b(drop|alter|delete)\b/i.test(input.sql)) await backup(p, b, actor.id, request);
          const result = await o.call('migration', { ...input, author: actor.id });
          audit(actor.id, 'migration.apply', input.id, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/sql',
        async ({ request, params, body }) => {
          const { o, p, b, actor } = await management(
            request,
            params.id,
            params.branch,
            'developer',
          );
          const sql = (body as any).sql;
          if (typeof sql !== 'string' || sql.length > 262144)
            throw new QBError('VALIDATION', 'Invalid SQL');
          if (!/^\s*(select|with)\b/i.test(sql)) await backup(p, b, actor.id, request);
          const result = await o.call('sql', { sql, author: actor.id });
          audit(actor.id, 'sql.execute', b.id, p, request);
          return success(result, request);
        },
      )
      .get('/management/v1/projects/:id/branches/:branch/policies', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch);
        return success(await o.call('policies'), request);
      })
      .put(
        '/management/v1/projects/:id/branches/:branch/policies',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('policy', { policy: body });
          audit(actor.id, 'policy.update', (body as any).resource, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/policies/test',
        async ({ request, params, body }) => {
          const { o } = await management(request, params.id, params.branch, 'developer');
          const input = body as any;
          if (!['anonymous', 'authenticated'].includes(input.identity?.role))
            throw new QBError('VALIDATION', 'Invalid simulated identity');
          const result = await o.call('read', { ...input, query: input.query ?? { limit: 10 } });
          return success(result.data, request, result.meta);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/exposure/:table',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          await o.call('expose', { ...(body as object), table: params.table });
          audit(actor.id, 'exposure.update', params.table, p, request);
          return success({ updated: true }, request);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/relationships',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('relationship', { relationship: body });
          audit(actor.id, 'relationship.register', result.name, p, request);
          return success(result, request);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/rpc',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('rpc-register', { operation: body });
          audit(actor.id, 'rpc.register', result.name, p, request);
          return success(result, request);
        },
      )
      .get('/management/v1/projects/:id/branches/:branch/rpc', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch);
        return success(await o.call('rpc-list'), request);
      })
      .get('/management/v1/projects/:id/branches/:branch/types', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch);
        return new Response(await o.call('types'), { headers: { 'content-type': 'text/plain' } });
      })
      .get('/management/v1/projects/:id/branches/:branch/users', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch, 'admin');
        return success(await o.call('users'), request);
      })
      .delete(
        '/management/v1/projects/:id/branches/:branch/users/:user/sessions',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          await o.call('revoke', { userId: params.user });
          audit(actor.id, 'session.revoke', params.user, p, request);
          return success({ revoked: true }, request);
        },
      )
      .get('/management/v1/projects/:id/backups', async ({ request, params }) => {
        const { actor } = await projectAccess(request, params.id);
        return controlList(
          'SELECT id,branch_id,checksum,schema_version,created_at FROM backups WHERE project_id=?',
          [params.id],
          request,
          actor.id,
          'created_at',
          true,
          'id',
        );
      })
      .post('/management/v1/projects/:id/branches/:branch/backups', async ({ request, params }) => {
        const { p, b, actor } = await management(request, params.id, params.branch, 'admin');
        return success(await backup(p, b, actor.id, request), request);
      })
      .post('/management/v1/projects/:id/backups/:backup/restore', async ({ request, params }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        const record = db
          .query('SELECT * FROM backups WHERE id=? AND project_id=?')
          .get(params.backup, p.id) as any;
        if (!record) throw new QBError('NOT_FOUND', 'Backup not available', 404);
        let bytes: Buffer;
        try {
          const encrypted = readFileSync(record.path);
          if (encrypted.length < 28) throw new Error('Invalid envelope');
          const dec = createDecipheriv(
            'aes-256-gcm',
            Buffer.from(realmSecret(config.master, 'backups'), 'hex'),
            encrypted.subarray(0, 12),
          );
          dec.setAuthTag(encrypted.subarray(-16));
          bytes = Buffer.concat([dec.update(encrypted.subarray(12, -16)), dec.final()]);
        } catch {
          throw new QBError('BACKUP_CORRUPT', 'Backup integrity validation failed', 409);
        }
        if (sha(bytes.toString('base64')) !== record.checksum)
          throw new QBError('BACKUP_CORRUPT', 'Backup checksum failed', 409);
        const id = crypto.randomUUID();
        const path = branchPath(config.dataDir, p.id, id);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, bytes, { mode: 0o600 });
        const restored = openDatabase(path);
        try {
          if (
            (restored.query('PRAGMA integrity_check').get() as any).integrity_check !== 'ok' ||
            restored.query('PRAGMA foreign_key_check').all().length
          )
            throw new QBError('RESTORE_INVALID', 'Restored database validation failed', 409);
          if (
            Number(
              (restored.query("SELECT value FROM _qb_meta WHERE key='schema_version'").get() as any)
                .value,
            ) !== Number(record.schema_version)
          )
            throw new QBError(
              'RESTORE_INVALID',
              'Snapshot schema version differs from its manifest',
              409,
            );
          restored.exec(
            "DELETE FROM _qb_auth_sessions; DELETE FROM _qb_auth_verifications; UPDATE _qb_objects SET state='unavailable';",
          );
          restored.exec(
            'UPDATE _qb_auth_accounts SET accessToken=NULL,refreshToken=NULL,idToken=NULL;',
          );
        } finally {
          restored.close(true);
        }
        db.query('INSERT INTO branches VALUES(?,?,?,?,?,?)').run(
          id,
          p.id,
          'restore-' + id.slice(0, 8),
          'ready',
          1,
          now(),
        );
        audit(actor.id, 'backup.restore', id, p, request);
        return success({ branchId: id, status: 'ready', sessionsExcluded: true }, request);
      })
      .post(
        '/management/v1/projects/:id/branches/:branch/cutover',
        async ({ request, params, body }) => {
          const { p, b, actor } = await management(request, params.id, params.branch, 'owner');
          if ((body as any).confirm !== p.slug)
            throw new QBError('VALIDATION', 'Confirm the project slug');
          const old = branch(p.id, 'primary');
          if (old.id === b.id) throw new QBError('CONFLICT', 'Branch is already primary', 409);
          if (fenced.has(p.id))
            throw new QBError('CONFLICT', 'Another cutover is in progress', 409);
          fenced.add(p.id);
          try {
            await backup(p, old, actor.id, request);
            if (owners.has(old.id)) {
              await owners.get(old.id)!.close();
              owners.delete(old.id);
            }
            db.transaction(() => {
              db.query(
                "UPDATE branches SET name=?,status='retired',generation=generation+1 WHERE id=?",
              ).run('previous-' + old.id.slice(0, 8), old.id);
              db.query("UPDATE branches SET name='main',generation=generation+1 WHERE id=?").run(
                b.id,
              );
            })();
            audit(actor.id, 'branch.cutover', b.id, p, request);
            return success({ branchId: b.id, previousBranchId: old.id }, request);
          } finally {
            fenced.delete(p.id);
          }
        },
      )
      .get('/management/v1/audit', async ({ request }) => {
        const actor = await user(request),
          scope = actor.tokenScope;
        const projects: string[] = scope?.projects ?? [],
          organizations: string[] = scope?.organizations ?? [];
        return controlList(
          `SELECT a.* FROM audit_events a JOIN memberships m ON m.org_id=a.org_id WHERE m.user_id=?${scope ? ` AND (a.project_id IN(${projects.map(() => '?').join(',') || 'NULL'}) OR a.org_id IN(${organizations.map(() => '?').join(',') || 'NULL'}))` : ''}`,
          [actor.id, ...projects, ...organizations],
          request,
          actor.id + JSON.stringify(scope),
          'time',
          true,
          'id',
        );
      })
      .get('/management/v1/projects/:id/branches/:branch/buckets', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch);
        return success(await o.call('buckets'), request);
      })
      .post(
        '/management/v1/projects/:id/branches/:branch/buckets',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const r = await o.call('bucket-create', body);
          audit(actor.id, 'bucket.create', r.id, p, request);
          return success(r, request);
        },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/buckets/:bucket/objects',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(
            await o.call('objects', { bucket: params.bucket, privileged: true }),
            request,
          );
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/buckets/:bucket/objects',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          backend.check();
          const result = await o.call('upload-intent', {
            ...(body as object),
            bucket: params.bucket,
            identity: { sub: actor.id, role: 'authenticated' },
            idempotency: request.headers.get('idempotency-key'),
            maxStorageBytes: cipher.open(p.config).quotas?.storageBytes ?? 1073741824,
          });
          audit(actor.id, 'storage.intent', result.id, p, request);
          return success(result, request);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/objects/:object/content',
        async ({ request, params }) => {
          const { o, p, b, actor } = await management(
            request,
            params.id,
            params.branch,
            'developer',
          );
          const obj = await o.call('object', { id: params.object, privileged: true });
          if (!['pending', 'failed', 'ready'].includes(obj.state))
            throw new QBError('CONFLICT', 'Object already finalized', 409);
          if (obj.state !== 'ready') await o.call('upload-claim', { id: obj.id });
          try {
            const bytes = new Uint8Array(await request.arrayBuffer());
            if (bytes.length !== Number(obj.size))
              throw new QBError('UPLOAD_MISMATCH', 'File size does not match intent', 409);
            const contentSha = createHash('sha256').update(bytes).digest('hex');
            if (obj.state === 'ready') {
              if (obj.content_sha !== contentSha)
                throw new QBError(
                  'IDEMPOTENCY_CONFLICT',
                  'Finalized object has different bytes',
                  409,
                );
              return success({ id: obj.id, state: 'ready' }, request);
            }
            const result = await backend.put(
              `${p.id}/${b.id}/${obj.id}`,
              bytes,
              bytes.length,
              obj.mime,
            );
            await o.call('object-state', {
              id: obj.id,
              state: 'ready',
              etag: result.etag,
              contentSha,
            });
            audit(actor.id, 'storage.upload', obj.id, p, request);
            return success({ id: obj.id, state: 'ready' }, request);
          } catch (error) {
            if (obj.state !== 'ready')
              await o.call('object-state', { id: obj.id, state: 'failed' });
            throw error;
          }
        },
        { parse: 'none' },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/objects/:object/content',
        async ({ request, params }) => {
          const { o, p, b } = await management(request, params.id, params.branch);
          const obj = await o.call('object', { id: params.object, privileged: true });
          if (obj.state !== 'ready') throw new QBError('NOT_FOUND', 'Object not ready', 404);
          const result = await backend.get(`${p.id}/${b.id}/${obj.id}`);
          return new Response(result.body, {
            headers: {
              'content-type': result.mime ?? 'application/octet-stream',
              'cache-control': 'private, no-store',
              'content-disposition': 'attachment',
            },
          });
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/objects/:object',
        async ({ request, params }) => {
          const { o, p, b, actor } = await management(
            request,
            params.id,
            params.branch,
            'developer',
          );
          const obj = await o.call('object', { id: params.object, privileged: true });
          await o.call('object-state', { id: obj.id, state: 'deleting' });
          await backend.delete(`${p.id}/${b.id}/${obj.id}`);
          await o.call('object-state', { id: obj.id, state: 'deleted' });
          audit(actor.id, 'storage.delete', obj.id, p, request);
          return success({ deleted: true }, request);
        },
      )
      .all('/v1/projects/:id/branches/:branch/auth/*', async ({ request, params }) => {
        const url = new URL(request.url);
        const callback =
          request.method === 'GET' &&
          /\/auth\/(?:callback\/(?:google|github)|verify-email|reset-password\/[^/]+)$/.test(
            url.pathname,
          );
        let access: { o: BranchOwner; b: any };
        if (callback) {
          if (fenced.has(params.id))
            throw new QBError('OWNER_UNAVAILABLE', 'Branch cutover is in progress', 503, true);
          const p = db
            .query("SELECT * FROM projects WHERE id=? AND status='ready'")
            .get(params.id) as any;
          if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
          const b = branch(p.id, params.branch);
          access = { b, o: owner(p, b) };
        } else access = await application(request, params.id, params.branch);
        const { o, b } = access;
        url.pathname = url.pathname.replace(
          `/branches/${params.branch}/auth/`,
          `/branches/${b.id}/auth/`,
        );
        const result = await o.call('auth', {
          url: url.toString(),
          method: request.method,
          headers: [...request.headers.entries()],
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
        });
        return new Response(result.body, { status: result.status, headers: result.headers });
      })
      .post(
        '/v1/projects/:id/branches/:branch/rpc/:operation',
        async ({ request, params, body }) => {
          const { o, identity } = await application(request, params.id, params.branch);
          const result = await o.call('rpc', {
            name: params.operation,
            args: body,
            identity,
            idempotency: request.headers.get('idempotency-key'),
          });
          return success(result.data, request, result.meta);
        },
      )
      .get('/v1/projects/:id/branches/:branch/schema', async ({ request, params }) => {
        const { o } = await application(request, params.id, params.branch);
        return success(await o.call('schema'), request);
      })
      .get('/v1/projects/:id/branches/:branch/openapi.json', async ({ request, params }) => {
        const { o } = await application(request, params.id, params.branch);
        const s = await o.call('schema');
        return projectOpenAPI(
          s.tables,
          await o.call('rpc-list'),
          s.schemaVersion,
          `${config.publicURL}/v1/projects/${params.id}/branches/${params.branch}`,
        );
      })
      .get('/v1/projects/:id/branches/:branch/data/:table', async ({ request, params, query }) => {
        const { o, identity, privileged } = await application(request, params.id, params.branch);
        const r = await o.call('read', {
          table: params.table,
          identity,
          privileged,
          query: {
            columns: query.select?.split(','),
            filters: query.filters ? JSON.parse(query.filters) : [],
            order: query.order ? JSON.parse(query.order) : [],
            limit: Number(query.limit ?? 50),
            cursor: query.cursor,
            count: query.count === 'true',
          },
        });
        return success(r.data, request, r.meta);
      })
      .post(
        '/v1/projects/:id/branches/:branch/data/:table/query',
        async ({ request, params, body }) => {
          const { o, identity, privileged } = await application(request, params.id, params.branch);
          const r = await o.call('read', {
            table: params.table,
            identity,
            privileged,
            query: body,
          });
          return success(r.data, request, r.meta);
        },
      )
      .post('/v1/projects/:id/branches/:branch/data/:table', async ({ request, params, body }) => {
        const { o, identity, privileged } = await application(request, params.id, params.branch);
        const r = await o.call('mutate', {
          table: params.table,
          identity,
          privileged,
          method: 'insert',
          input: body,
          idempotency: request.headers.get('idempotency-key'),
        });
        return success(r.data, request, r.meta);
      })
      .post(
        '/v1/projects/:id/branches/:branch/data/:table/upsert',
        async ({ request, params, body }) => {
          const { o, identity, privileged } = await application(request, params.id, params.branch);
          const r = await o.call('mutate', {
            table: params.table,
            identity,
            privileged,
            method: 'upsert',
            input: body,
            idempotency: request.headers.get('idempotency-key'),
          });
          return success(r.data, request, r.meta);
        },
      )
      .patch(
        '/v1/projects/:id/branches/:branch/data/:table/:key',
        async ({ request, params, body }) => {
          const { o, identity, privileged } = await application(request, params.id, params.branch);
          const r = await o.call('mutate', {
            table: params.table,
            identity,
            privileged,
            method: 'update',
            input: body,
            key: params.key,
            idempotency: request.headers.get('idempotency-key'),
            revision: request.headers.has('if-match')
              ? Number(request.headers.get('if-match'))
              : undefined,
          });
          return success(r.data, request, r.meta);
        },
      )
      .delete('/v1/projects/:id/branches/:branch/data/:table/:key', async ({ request, params }) => {
        const { o, identity, privileged } = await application(request, params.id, params.branch);
        const r = await o.call('mutate', {
          table: params.table,
          identity,
          privileged,
          method: 'delete',
          key: params.key,
          idempotency: request.headers.get('idempotency-key'),
        });
        return success(r.data, request, r.meta);
      })
      .get('/v1/projects/:id/branches/:branch/storage/buckets', async ({ request, params }) => {
        const { o } = await application(request, params.id, params.branch);
        return success(await o.call('buckets'), request);
      })
      .get(
        '/v1/projects/:id/branches/:branch/storage/buckets/:bucket/objects',
        async ({ request, params }) => {
          const { o, identity, privileged } = await application(request, params.id, params.branch);
          return success(await o.call('objects', { bucket: params.bucket, identity }), request);
        },
      )
      .post(
        '/v1/projects/:id/branches/:branch/storage/buckets/:bucket/objects',
        async ({ request, params, body }) => {
          const { o, identity, privileged, p } = await application(
            request,
            params.id,
            params.branch,
          );
          backend.check();
          return success(
            await o.call('upload-intent', {
              ...(body as object),
              bucket: params.bucket,
              identity,
              idempotency: request.headers.get('idempotency-key'),
              maxStorageBytes: cipher.open(p.config).quotas?.storageBytes ?? 1073741824,
            }),
            request,
          );
        },
      )
      .put(
        '/v1/projects/:id/branches/:branch/storage/objects/:object/content',
        async ({ request, params }) => {
          const { o, identity, p, b } = await application(request, params.id, params.branch);
          const obj = await o.call('object', { id: params.object, identity });
          if (!['pending', 'failed', 'ready'].includes(obj.state))
            throw new QBError('CONFLICT', 'Object is already finalized', 409);
          if (obj.state !== 'ready') await o.call('upload-claim', { id: obj.id });
          try {
            const bytes = new Uint8Array(await request.arrayBuffer());
            if (bytes.length !== Number(obj.size))
              throw new QBError('UPLOAD_MISMATCH', 'File size does not match intent', 409);
            const contentSha = createHash('sha256').update(bytes).digest('hex');
            if (obj.state === 'ready') {
              if (obj.content_sha !== contentSha)
                throw new QBError(
                  'IDEMPOTENCY_CONFLICT',
                  'Finalized object has different bytes',
                  409,
                );
              return success({ id: obj.id, state: 'ready' }, request);
            }
            const result = await backend.put(
              `${p.id}/${b.id}/${obj.id}`,
              bytes,
              bytes.length,
              obj.mime,
            );
            await o.call('object-state', {
              id: obj.id,
              state: 'ready',
              etag: result.etag,
              contentSha,
            });
            return success({ id: obj.id, state: 'ready' }, request);
          } catch (error) {
            if (obj.state !== 'ready')
              await o.call('object-state', { id: obj.id, state: 'failed' });
            throw error;
          }
        },
        { parse: 'none' },
      )
      .get(
        '/v1/projects/:id/branches/:branch/storage/objects/:object/content',
        async ({ request, params }) => {
          const { o, identity, p, b } = await application(request, params.id, params.branch);
          const obj = await o.call('object', { id: params.object, identity, read: true });
          if (obj.state !== 'ready') throw new QBError('NOT_FOUND', 'Object not ready', 404);
          const result = await backend.get(`${p.id}/${b.id}/${obj.id}`);
          return new Response(result.body, {
            headers: {
              'content-type': result.mime ?? 'application/octet-stream',
              'cache-control': 'private, no-store',
              'content-disposition': 'attachment',
            },
          });
        },
      )
      .delete(
        '/v1/projects/:id/branches/:branch/storage/objects/:object',
        async ({ request, params }) => {
          const { o, identity, p, b } = await application(request, params.id, params.branch);
          const obj = await o.call('object', { id: params.object, identity });
          await o.call('object-state', { id: obj.id, state: 'deleting' });
          await backend.delete(`${p.id}/${b.id}/${obj.id}`);
          await o.call('object-state', { id: obj.id, state: 'deleted' });
          return success({ deleted: true }, request);
        },
      );
    return {
      app,
      config,
      db,
      platform,
      owners,
      application,
      management,
      success,
      backup,
      tick,
      maintain,
      async close() {
        for (const t of timers) clearInterval(t);
        await Promise.allSettled([...owners.values()].map((o) => o.close()));
        db.close(true);
        release();
      },
      timers,
    };
  } catch (error) {
    release();
    throw error;
  }
}
