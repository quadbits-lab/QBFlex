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
import { isIP } from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  configuration,
  normalizeOrigins,
  openDatabase,
  branchPath,
  BranchOwner,
} from '@qb-flex/database';
import { createRealm, realmSecret, encryption, createMailer } from '@qb-flex/auth';
import {
  QBError,
  capabilities,
  routes,
  jobKinds,
  isValidAlertKind,
  isValidAlertSeverity,
  type Identity,
  type Role,
} from '@qb-flex/contracts';
import { normalize, cursorCodec } from '@qb-flex/query-engine';
import { ObjectBackend } from '@qb-flex/storage';
import { stageTransfer } from '../../../packages/storage/src/transfer';
import { ResumableUploads } from '../../../packages/storage/src/resumable';
import { transformImage } from '../../../packages/storage/src/transform';
import { acquireLease } from '../../../packages/database/src/lease';
import {
  writeControlSnapshot,
  cleanupControlStaging,
} from '../../../packages/database/src/control-backup';
import { encryptArchive, decryptArchive } from '../../../packages/database/src/archive';
import { Database, restoreDatabase } from '@qb-flex/database';
import { databaseBytes } from '../../../packages/database/src/connection';
import { log, Metrics } from '@qb-flex/observability';
import { resolveBootstrapToken, bootstrapTokenMatches } from './bootstrap';
import {
  webhookURL,
  publicAddress,
  parseInternalAllowlist,
  deliverWebhook,
} from '../../worker/src/webhook-delivery';
import { controlFindings } from '../../../packages/database/src/security-advisor';
import {
  loadRecoverySettings,
  saveRecoverySettings,
  validateDestinationInput,
  destinationSummary,
  buildInventory,
  drillSummary,
  applyRetention,
  uploadBackupReplicas,
  executeDrill,
  scheduledBackupsEnabled,
} from './recovery';
import {
  previewTtlHours,
  previewSummary,
  previewPath,
} from '../../../packages/database/src/previews';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
export async function createService(override?: Partial<ReturnType<typeof configuration>>) {
  const config = { ...configuration(), ...override };
  config.origins = normalizeOrigins(config.origins);
  if (existsSync(join(config.dataDir, 'engine.migrating.json')))
    throw new QBError(
      'ENGINE_MIGRATION_REQUIRED',
      'Incomplete engine conversion; validate or rerun conversion before startup',
      409,
    );
  if (existsSync(join(config.dataDir, 'control.sqlite')))
    throw new QBError(
      'ENGINE_MIGRATION_REQUIRED',
      'Run offline db migrate-engine into a separate directory',
      409,
    );
  const release = acquireLease(config.dataDir);
  try {
    cleanupControlStaging(config.dataDir);
    const transferDirectory = join(config.dataDir, 'transfers');
    const resumableDirectory = join(config.dataDir, 'resumable');
    const resumableUploads = new ResumableUploads(resumableDirectory);
    // Exclusive data-volume lease is held: these are abandoned staging files, never object bytes.
    if (existsSync(transferDirectory))
      for (const entry of readdirSync(transferDirectory))
        if (/^transfer-[a-zA-Z0-9]+$/.test(entry))
          rmSync(join(transferDirectory, entry), { recursive: true, force: true });
    const backupsDirectory = join(config.dataDir, 'backups');
    if (existsSync(backupsDirectory))
      for (const entry of readdirSync(backupsDirectory))
        if (/^[a-f0-9-]{36}\.(?:sqlite|pglite\.tar)(?:\.enc\.partial-[a-f0-9-]{36})?$/.test(entry))
          rmSync(join(backupsDirectory, entry), { force: true });
    const recoveryDrillsDirectory = join(config.dataDir, 'recovery-drills');
    if (existsSync(recoveryDrillsDirectory))
      for (const entry of readdirSync(recoveryDrillsDirectory))
        if (/^[a-f0-9-]{36}$/.test(entry))
          rmSync(join(recoveryDrillsDirectory, entry), { recursive: true, force: true });
    const db = openDatabase(join(config.dataDir, 'control.pglite'), false);
    await db.exec(
      'CREATE TABLE IF NOT EXISTS engine_migrations(id TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)',
    );
    const cipher = encryption(config.master);
    const platform = await createRealm(db, {
      secret: realmSecret(config.master, 'platform'),
      baseURL: config.publicURL,
      basePath: '/platform/auth',
      origins: normalizeOrigins([config.studioURL]),
      platform: true,
    });
    for (const id of [
      '001-foundation',
      '002-credentials',
      '003-delivery-security',
      '004-workspace-lifecycle',
      '005-recovery',
      '006-reviews-previews',
      '007-alerts',
    ]) {
      const migration = readFileSync(
        new URL(`../../../migrations/pglite/${id}.sql`, import.meta.url),
        'utf8',
      );
      const checksum = sha(migration);
      const hasRegistry = await db
        .query(
          "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='engine_migrations'",
        )
        .get();
      const existing = hasRegistry
        ? ((await db.query('SELECT checksum FROM engine_migrations WHERE id=?').get(id)) as any)
        : null;
      if (existing && existing.checksum !== checksum)
        throw new Error('Control migration checksum mismatch');
      if (!existing)
        await db
          .transaction(async (tx) => {
            await tx.exec(migration);
            await tx.query('INSERT INTO engine_migrations VALUES(?,?,?)').run(id, checksum, now());
          })
          .immediate();
    }
    const metrics = new Metrics();
    const mailer = createMailer();
    const webhookAllowlist = parseInternalAllowlist(process.env.QB_WEBHOOK_INTERNAL_ALLOWLIST);
    const starts = new WeakMap<Request, number>();
    const transfers = new WeakSet<Request>();
    let activeTransfers = 0,
      activeBackups = 0;
    function releaseTransfer(request: Request) {
      if (transfers.delete(request)) activeTransfers--;
    }
    const fenced = new Set<string>();
    const owners = new Map<string, BranchOwner>();
    const executorOnly = new Set<string>();
    const lastUsed = new Map<string, number>();
    const backend = new ObjectBackend();
    const timers = new Set<ReturnType<typeof setInterval>>();
    let lastMetricsSnapshot = new Map<
      string,
      { count: number; errors: number; total: number; max: number; buckets: number[] }
    >();
    const deadLetterDepths = new Map<string, number>();
    const bootstrapState = resolveBootstrapToken({
      hasOwner: Boolean(await db.query('SELECT id FROM _qb_auth_users LIMIT 1').get()),
      configured: config.bootstrapToken,
    });
    let bootstrap = bootstrapState.token;
    // Safe to log: the source name only, never the token value.
    log({ action: 'bootstrap.token_source', code: bootstrapState.source });
    const success = (data: unknown, request: Request, meta: object = {}) => ({
      data: normalize(data),
      meta: { requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(), ...meta },
    });
    const managementCursor = cursorCodec(realmSecret(config.master, 'management-cursors'));
    async function controlList(
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
      const rows = (await db
        .query(
          `SELECT * FROM (${sql}) ${after ? `WHERE ("${key}","${tie}") ${comparison} (?,?)` : ''} ORDER BY "${key}" ${direction},"${tie}" ${direction} LIMIT ?`,
        )
        .all(
          ...([...values, ...(after ? [after.key, after.tie] : []), limit + 1] as any[]),
        )) as any[];
      const data = rows.slice(0, limit),
        last = data.at(-1);
      return success(data, request, {
        cursor:
          rows.length > limit
            ? managementCursor.encode({ scope, key: last[key], tie: last[tie] })
            : undefined,
      });
    }
    const workspaceStorageConfigured = () =>
      !!(
        process.env.QB_S3_ENDPOINT &&
        process.env.QB_S3_ACCESS_KEY &&
        process.env.QB_S3_SECRET_KEY
      );
    const audit = async (
      actor: string,
      action: string,
      resource: string,
      project: any,
      request: Request,
      result = 'success',
    ) =>
      await db
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
        const row = (await db
          .query(
            'SELECT user_id FROM management_tokens WHERE hash=? AND revoked_at IS NULL AND expires_at>?',
          )
          .get(sha(token), now())) as any;
        if (row) {
          const scope = (await db
            .query(
              'SELECT definition FROM token_scopes WHERE token_id=(SELECT id FROM management_tokens WHERE hash=?)',
            )
            .get(sha(token))) as any;
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
    async function member(org: string, id: string, min: Role = 'viewer') {
      const row = (await db
        .query('SELECT role FROM memberships WHERE org_id=? AND user_id=?')
        .get(org, id)) as any;
      if (!row || ranks[row.role as Role] < ranks[min])
        throw new QBError('DENIED', 'Organization permission required', 403);
      if (
        (process.env.QB_REQUIRE_ADMIN_MFA === 'true' ||
          (process.env.NODE_ENV === 'production' &&
            process.env.QB_REQUIRE_ADMIN_MFA !== 'false')) &&
        ranks[min] >= 1 &&
        ranks[row.role as Role] >= 2
      ) {
        const account = (await db
          .query('SELECT "twoFactorEnabled" FROM _qb_auth_users WHERE id=?')
          .get(id)) as any;
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
      const p = (await db.query('SELECT * FROM projects WHERE id=?').get(id)) as any;
      if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
      await member(p.org_id, actor.id, min);
      if (
        actor.tokenScope &&
        ((!actor.tokenScope.projects.includes(id) &&
          !actor.tokenScope.organizations.includes(p.org_id)) ||
          (actor.tokenScope.readOnly && min !== 'viewer'))
      )
        throw new QBError('TOKEN_SCOPE', 'Management token does not grant this operation', 403);
      return { p, actor };
    }
    async function branch(project: string, id: string) {
      const b = (await db
        .query('SELECT * FROM branches WHERE project_id=? AND (id=? OR name=?)')
        .get(project, id, id === 'primary' ? 'main' : id)) as any;
      if (!b || b.status !== 'ready')
        throw new QBError('OWNER_UNAVAILABLE', 'Branch not ready', 503, true);
      return b;
    }

    async function releaseProjectOwners(project: any) {
      const branches = (await db
        .query('SELECT * FROM branches WHERE project_id=?')
        .all(project.id)) as any[];
      for (const branch of branches) {
        if (owners.has(branch.id)) {
          await owners
            .get(branch.id)!
            .close()
            .catch(() => {});
          owners.delete(branch.id);
          executorOnly.delete(branch.id);
          lastUsed.delete(branch.id);
        }
      }
      return branches;
    }
    async function purgeProjectStorage(project: any, branches: any[]) {
      if (!workspaceStorageConfigured()) return;
      for (const branch of branches) {
        try {
          const o = owner(project, branch, false);
          try {
            const objects = (await o.call('purge-storage-keys')) as any[];
            for (const object of objects)
              await backend.delete(`${project.id}/${branch.id}/${object.id}`);
          } finally {
            await o.close().catch(() => {});
          }
        } catch (error) {
          // Storage cleanup only applies to the configured project prefix.
          if ((error as any)?.code !== 'STORAGE_UNCONFIGURED') throw error;
        }
      }
    }
    function removeProjectFiles(project: any) {
      rmSync(join(config.dataDir, 'functions', project.id), { recursive: true, force: true });
      rmSync(join(config.dataDir, 'projects', project.id), { recursive: true, force: true });
    }
    async function purgeProjectArtifacts(project: any) {
      const branches = await releaseProjectOwners(project);
      await purgeProjectStorage(project, branches);
      removeProjectFiles(project);
    }
    async function deleteProjectCatalog(project: any) {
      const projectId = project.id;
      await db.transaction(async (tx) => {
        await tx.query('DELETE FROM secret_versions WHERE project_id=?').run(projectId);
        await tx.query('DELETE FROM project_config_versions WHERE project_id=?').run(projectId);
        await tx
          .query(
            'DELETE FROM project_key_metadata WHERE key_id IN(SELECT id FROM project_keys WHERE project_id=?)',
          )
          .run(projectId);
        await tx
          .query(
            'DELETE FROM credential_scopes WHERE key_id IN(SELECT id FROM project_keys WHERE project_id=?)',
          )
          .run(projectId);
        await tx.query('DELETE FROM project_keys WHERE project_id=?').run(projectId);
        await tx.query('DELETE FROM backups WHERE project_id=?').run(projectId);
        await tx
          .query(
            'DELETE FROM branch_job_targets WHERE branch_id IN(SELECT id FROM branches WHERE project_id=?)',
          )
          .run(projectId);
        await tx.query('DELETE FROM branches WHERE project_id=?').run(projectId);
        await tx.query('DELETE FROM operations WHERE project_id=?').run(projectId);
        await tx.query('DELETE FROM audit_events WHERE project_id=?').run(projectId);
        await tx.query('DELETE FROM projects WHERE id=?').run(projectId);
      })();
    }
    async function deleteProjectArtifacts(project: any) {
      const backupRows = (await db
        .query('SELECT path FROM backups WHERE project_id=?')
        .all(project.id)) as any[];
      const branches = await releaseProjectOwners(project);
      await purgeProjectStorage(project, branches);
      await deleteProjectCatalog(project);
      for (const backup of backupRows) rmSync(backup.path, { force: true });
      removeProjectFiles(project);
    }
    async function deleteWorkspaceData(orgId: string, projects: any[]) {
      const projectIds = projects.map((project) => project.id),
        placeholders = projectIds.map(() => '?').join(',') || 'NULL';
      await db.transaction(async (tx) => {
        if (projectIds.length) {
          await tx
            .query(`DELETE FROM secret_versions WHERE project_id IN(${placeholders})`)
            .run(...projectIds);
          await tx
            .query(`DELETE FROM project_config_versions WHERE project_id IN(${placeholders})`)
            .run(...projectIds);
          await tx
            .query(
              `DELETE FROM project_key_metadata WHERE key_id IN(SELECT id FROM project_keys WHERE project_id IN(${placeholders}))`,
            )
            .run(...projectIds);
          await tx
            .query(
              `DELETE FROM credential_scopes WHERE key_id IN(SELECT id FROM project_keys WHERE project_id IN(${placeholders}))`,
            )
            .run(...projectIds);
          await tx
            .query(`DELETE FROM project_keys WHERE project_id IN(${placeholders})`)
            .run(...projectIds);
          await tx
            .query(`DELETE FROM backups WHERE project_id IN(${placeholders})`)
            .run(...projectIds);
          await tx
            .query(
              `DELETE FROM branch_job_targets WHERE branch_id IN(SELECT id FROM branches WHERE project_id IN(${placeholders}))`,
            )
            .run(...projectIds);
          await tx
            .query(`DELETE FROM branches WHERE project_id IN(${placeholders})`)
            .run(...projectIds);
          await tx
            .query(`DELETE FROM operations WHERE project_id IN(${placeholders})`)
            .run(...projectIds);
          await tx
            .query(`DELETE FROM audit_events WHERE org_id=? OR project_id IN(${placeholders})`)
            .run(orgId, ...projectIds);
          await tx.query(`DELETE FROM projects WHERE id IN(${placeholders})`).run(...projectIds);
        } else {
          await tx.query('DELETE FROM audit_events WHERE org_id=?').run(orgId);
        }
        await tx.query('DELETE FROM memberships WHERE org_id=?').run(orgId);
        await tx.query('DELETE FROM organizations WHERE id=?').run(orgId);
      })();
    }
    async function deleteWorkspaceArtifacts(orgId: string) {
      const projects = (await db
        .query('SELECT * FROM projects WHERE org_id=?')
        .all(orgId)) as any[];
      const backupRows = (await db
        .query(
          `SELECT path FROM backups WHERE project_id IN(${projects.map(() => '?').join(',') || 'NULL'})`,
        )
        .all(...projects.map((project) => project.id))) as any[];
      // Close owners and purge remote storage before catalog deletion.
      const branchMap = new Map<string, any[]>();
      for (const project of projects) {
        branchMap.set(project.id, await releaseProjectOwners(project));
        await purgeProjectStorage(project, branchMap.get(project.id)!);
      }
      // Commit catalog removal first so a later filesystem failure cannot leave live rows.
      await deleteWorkspaceData(orgId, projects);
      for (const backup of backupRows) rmSync(backup.path, { force: true });
      for (const project of projects) removeProjectFiles(project);
    }
    function owner(p: any, b: any, touch = true) {
      if (touch) {
        lastUsed.set(b.id, Date.now());
        executorOnly.delete(b.id);
      }
      let o = owners.get(b.id);
      if (o && !o.available) {
        owners.delete(b.id);
        o = undefined;
      }
      if (!o) {
        if (owners.size >= config.maxBranchOwners)
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
          branchId: b.id,
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
      const p = (await db
        .query("SELECT * FROM projects WHERE id=? AND status='ready'")
        .get(id)) as any;
      if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
      const key = request.headers.get('x-qb-key');
      const credential = key
        ? ((await db
            .query(
              'SELECT id,scope FROM project_keys WHERE project_id=? AND hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',
            )
            .get(id, sha(key), now())) as any)
        : null;
      if (!credential || !['publishable', 'service'].includes(credential.scope))
        throw new QBError('UNAUTHORIZED', 'Valid project key required', 401);
      const settings = cipher.open(p.config);
      const origin = request.headers.get('origin');
      const projectOrigins = normalizeOrigins(settings.origins ?? config.origins);
      if (origin && !projectOrigins.includes(origin))
        throw new QBError('DENIED', 'Origin not allowed for this project', 403);
      const b = await branch(id, bid);
      const o = owner(p, b);
      if (
        request.method !== 'GET' &&
        /\/data\//.test(new URL(request.url).pathname) &&
        !new URL(request.url).pathname.endsWith('/query')
      ) {
        const file = branchPath(config.dataDir, p.id, b.id),
          bytes = databaseBytes(file);
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
        const record = (await db
          .query('SELECT definition FROM credential_scopes WHERE key_id=?')
          .get(credential.id)) as any;
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
        identity = { sub: credential.id, role: 'service', roles: [] };
        bypass = scope.bypass === true;
        if (bypass) await audit(credential.id, 'service.bypass', resource, p, request);
      }
      return {
        p,
        b,
        o,
        identity: (identity ?? { sub: null, role: 'anonymous', roles: [] }) as Identity,
        privileged: bypass,
      };
    }
    async function management(request: Request, id: string, bid: string, min: Role = 'viewer') {
      const access = await projectAccess(request, id, min);
      if (request.method !== 'GET' && fenced.has(id))
        throw new QBError('OWNER_UNAVAILABLE', 'Branch cutover is in progress', 503, true);
      const b = await branch(id, bid);
      return { ...access, b, o: owner(access.p, b) };
    }
    async function backup(p: any, b: any, actor: string, request: Request) {
      if (activeBackups >= 2)
        throw new QBError('BACKUP_BUSY', 'Backup capacity reached; retry later', 503, true);
      activeBackups++;
      try {
        const id = crypto.randomUUID();
        const raw = join(config.dataDir, 'backups', id + '.pglite.tar');
        mkdirSync(join(raw, '..'), { recursive: true, mode: 0o700 });
        const snapshotResult = await owner(p, b, false).call('snapshot', { path: raw }, 60000);
        const path = raw + '.enc';
        let archive;
        let schemaVersion: number;
        try {
          schemaVersion = snapshotResult.schemaVersion;
          archive = await encryptArchive(
            raw,
            path,
            Buffer.from(realmSecret(config.master, 'backups'), 'hex'),
            {
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
              // Recovery must remain possible when operators lower a branch's write quota.
              maxBytes: Math.max(1073741824, cipher.open(p.config).quotas?.databaseBytes ?? 0),
              engine: { name: 'pglite', version: '0.5.10' },
            },
          );
        } finally {
          rmSync(raw, { force: true });
        }
        await db
          .query('INSERT INTO backups VALUES(?,?,?,?,?,?,?)')
          .run(id, p.id, b.id, archive.checksum, path, schemaVersion, now());
        await uploadBackupReplicas(db, p, id, path, cipher, config.dataDir, request.signal);
        await audit(actor, 'backup.create', id, p, request);
        return { id, createdAt: now(), schemaVersion, format: archive.format };
      } finally {
        activeBackups--;
      }
    }
    async function enqueueRecoveryDrill(
      p: any,
      b: any,
      backupId: string,
      o: BranchOwner,
      actor: string,
      request: Request,
    ) {
      const open = (await db
        .query(
          "SELECT id FROM recovery_drills WHERE project_id=? AND state IN('queued','restoring','validating') LIMIT 1",
        )
        .get(p.id)) as any;
      if (open) throw new QBError('CONFLICT', 'A recovery drill is already in progress', 409);
      const backup = (await db
        .query('SELECT id FROM backups WHERE id=? AND project_id=?')
        .get(backupId, p.id)) as any;
      if (!backup) throw new QBError('NOT_FOUND', 'Backup not available', 404);
      const id = crypto.randomUUID();
      const created = now();
      await db
        .query(
          'INSERT INTO recovery_drills(id,project_id,backup_id,branch_id,job_id,state,database_result,objects_result,key_result,report,created_at,updated_at,finished_at) VALUES(?,?,?,?,NULL,?,NULL,NULL,NULL,NULL,?,?,NULL)',
        )
        .run(id, p.id, backupId, b.id, 'queued', created, created);
      await db.query('INSERT INTO branch_job_targets VALUES(?) ON CONFLICT DO NOTHING').run(b.id);
      const job = await o.call('jobs-submit', {
        kind: 'recovery.drill',
        deduplicationKey: 'recovery-drill:' + id,
        eventId: id,
        payload: { drillId: id, projectId: p.id, backupId },
      });
      await db
        .query('UPDATE recovery_drills SET job_id=?,updated_at=? WHERE id=?')
        .run(job.id, now(), id);
      await audit(actor, 'recovery.drill', id, p, request);
      return drillSummary(
        (await db.query('SELECT * FROM recovery_drills WHERE id=?').get(id)) as any,
      );
    }
    // Single control-plane owner resumes pending provision operations after a restart.
    async function tick() {
      const operations = (await db
        .query(
          "SELECT o.*,p.config,p.org_id FROM operations o JOIN projects p ON p.id=o.project_id WHERE o.status IN('requested','running') AND o.type='provision' LIMIT 8",
        )
        .all()) as any[];
      for (const operation of operations) {
        await db
          .query("UPDATE operations SET status='running',progress=25 WHERE id=?")
          .run(operation.id);
        try {
          const p = (await db
            .query('SELECT * FROM projects WHERE id=?')
            .get(operation.project_id)) as any;
          const b = (await db
            .query("SELECT * FROM branches WHERE project_id=? AND name='main'")
            .get(p.id)) as any;
          await owner(p, b).call('schema', { privileged: true });
          await db.transaction(async (tx) => {
            await tx.query("UPDATE branches SET status='ready' WHERE id=?").run(b.id);
            await tx.query("UPDATE projects SET status='ready' WHERE id=?").run(p.id);
            await tx
              .query("UPDATE operations SET status='succeeded',progress=100 WHERE id=?")
              .run(operation.id);
          })();
        } catch (error) {
          if (
            error instanceof QBError &&
            ['OWNER_LIMIT', 'OWNER_UNAVAILABLE', 'QUEUE_FULL'].includes(error.code)
          ) {
            await db
              .query("UPDATE operations SET status='requested',progress=0 WHERE id=?")
              .run(operation.id);
            continue;
          }
          await db
            .query("UPDATE operations SET status='failed',error=? WHERE id=?")
            .run('Provisioning failed; inspect operator logs', operation.id);
          await db
            .query("UPDATE projects SET status='failed' WHERE id=?")
            .run(operation.project_id);
          await db
            .query("UPDATE branches SET status='failed' WHERE project_id=?")
            .run(operation.project_id);
          log({ action: 'provision.failed' });
        }
      }
    }
    let ticking = false;
    const tickTimer = setInterval(async () => {
      if (ticking) return;
      ticking = true;
      void tick().finally(() => (ticking = false));
    }, 1000);
    timers.add(tickTimer);
    let maintenanceTask: Promise<unknown> | undefined;
    let closing = false;
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
      const suppliedBytes = Buffer.from(supplied),
        expectedBytes = Buffer.from(workerToken!);
      if (
        suppliedBytes.length !== expectedBytes.length ||
        !timingSafeEqual(suppliedBytes, expectedBytes)
      )
        throw new QBError('UNAUTHORIZED', 'Worker authentication required', 401);
    }
    const pushToken = process.env.QB_PUSH_WORKER_TOKEN;
    const pushEnabled = process.env.QB_PUSH_ENABLED === 'true';
    if (pushEnabled && (!pushToken || pushToken.length < 32 || pushToken === workerToken))
      throw new Error(
        'Push job executor requires a distinct QB_PUSH_WORKER_TOKEN of at least 32 characters',
      );
    function executorKinds(request: Request) {
      const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      if (
        pushEnabled &&
        pushToken &&
        Buffer.byteLength(supplied) === Buffer.byteLength(pushToken) &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(pushToken))
      )
        return jobKinds.filter((k) => k.startsWith('push.'));
      internal(request);
      return jobKinds.filter((k) => !k.startsWith('push.'));
    }
    async function executorTarget(input: any) {
      if (
        !input ||
        ![input.projectId, input.branchId].every(
          (value) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value),
        )
      )
        throw new QBError(
          'VALIDATION',
          'Executor requires project and immutable branch identifiers',
        );
      const p = (await db
        .query("SELECT * FROM projects WHERE id=? AND status='ready'")
        .get(input.projectId)) as any;
      if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
      const b = await branch(p.id, input.branchId);
      if (fenced.has(b.id) || fenced.has(p.id))
        throw new QBError('OWNER_UNAVAILABLE', 'Branch is fenced', 503, true);
      const existing = owners.get(b.id)?.available === true,
        selected = owner(p, b, false);
      if (!existing) executorOnly.add(b.id);
      return selected;
    }
    async function webhookScope(projectId: string, branchId: string, keyId: string, table: string) {
      if (
        typeof keyId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(keyId) ||
        typeof table !== 'string' ||
        table.length > 100
      )
        throw new QBError('VALIDATION', 'Webhook requires a service key ID and table');
      const row = (await db
        .query('SELECT scope,revoked_at,expires_at FROM project_keys WHERE id=? AND project_id=?')
        .get(keyId, projectId)) as any;
      if (
        !row ||
        row.scope !== 'service' ||
        row.revoked_at ||
        (row.expires_at &&
          (!Number.isFinite(Date.parse(row.expires_at)) ||
            Date.parse(row.expires_at) <= Date.now()))
      )
        return 'KEY_REVOKED' as const;
      const record = (await db
        .query('SELECT definition FROM credential_scopes WHERE key_id=?')
        .get(keyId)) as any;
      const scope = record ? JSON.parse(record.definition) : null;
      if (
        !scope ||
        scope.branch !== branchId ||
        scope.bypass === true ||
        !scope.tables?.includes(table) ||
        !scope.methods?.includes('GET')
      )
        return 'KEY_SCOPE' as const;
      return null;
    }
    async function maintain() {
      if (closing)
        return Promise.reject(new QBError('UNAVAILABLE', 'API is shutting down', 503, true));
      if (maintenanceTask) return Promise.resolve({ running: true });
      const task = performMaintenance();
      maintenanceTask = task;
      // Preserve caller errors without leaving an unhandled rejection from cleanup.
      void task.then(
        () => {
          maintenanceTask = undefined;
        },
        () => {
          maintenanceTask = undefined;
        },
      );
      return task;
    }
    async function performMaintenance() {
      let cleaned = 0,
        backedUp = 0;
      deadLetterDepths.clear();
      async function evaluateAlerts() {
        const rules = (await db
          .query('SELECT * FROM alert_rules WHERE enabled=1')
          .all()) as any[];
        if (!rules.length) return;
        const currentSnapshot = metrics.snapshot();
        const nowTime = Date.now();
        const bounds = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
        function p95(value: { count: number; buckets: number[] }) {
          if (!value.count) return 0;
          const target = value.count * 0.95;
          let cumulative = 0;
          for (let i = 0; i < bounds.length; i++) {
            cumulative += value.buckets[i]!;
            if (cumulative >= target) {
              const prev = i > 0 ? bounds[i - 1]! : 0;
              const frac = (target - (cumulative - value.buckets[i]!)) / value.buckets[i]!;
              return prev + (bounds[i]! - prev) * Math.max(0, Math.min(1, frac));
            }
          }
          return bounds[bounds.length - 1]!;
        }
        function deltaErrors(key: string) {
          const current = currentSnapshot.get(key);
          if (!current) return 0;
          const previous = lastMetricsSnapshot.get(key);
          return current.errors - (previous?.errors ?? 0);
        }
        function deltaCount(key: string) {
          const current = currentSnapshot.get(key);
          if (!current) return 0;
          const previous = lastMetricsSnapshot.get(key);
          return current.count - (previous?.count ?? 0);
        }
        const studioUrl = config.studioURL ?? `${config.publicURL}/studio`;
        for (const rule of rules) {
          try {
            const ruleConfig = JSON.parse(rule.config) as { threshold: number; route?: string; windowMinutes?: number; silenceMinutes?: number };
            const state = (await db.query('SELECT * FROM alert_states WHERE rule_id=?').get(rule.id)) as any;
            const silencedUntil = state?.silenced_until ? Date.parse(state.silenced_until) : 0;
            if (silencedUntil > nowTime) continue;
            const lastFired = state?.last_fired_at ? Date.parse(state.last_fired_at) : 0;
            const windowMinutes = Number(ruleConfig.windowMinutes ?? 5);
            const windowStart = new Date(nowTime - windowMinutes * 60000).toISOString();
            let triggered = false;
            let title = rule.name;
            let details = '';
            const routeKey = ruleConfig.route;
            switch (rule.kind as string) {
              case 'error_rate': {
                let errors = 0;
                let count = 0;
                if (routeKey) {
                  errors = deltaErrors(routeKey);
                  count = deltaCount(routeKey);
                } else {
                  for (const [key, value] of currentSnapshot) {
                    const prev = lastMetricsSnapshot.get(key);
                    errors += value.errors - (prev?.errors ?? 0);
                    count += value.count - (prev?.count ?? 0);
                  }
                }
                const rate = count > 0 ? errors / count : 0;
                if (rate >= ruleConfig.threshold) {
                  triggered = true;
                  details = `Error rate ${(rate * 100).toFixed(1)}% over ${count} requests (threshold ${(ruleConfig.threshold * 100).toFixed(1)}%)`;
                }
                break;
              }
              case 'error_count': {
                let errors = 0;
                if (routeKey) {
                  errors = deltaErrors(routeKey);
                } else {
                  for (const [key, value] of currentSnapshot) {
                    const prev = lastMetricsSnapshot.get(key);
                    errors += value.errors - (prev?.errors ?? 0);
                  }
                }
                if (errors >= ruleConfig.threshold) {
                  triggered = true;
                  details = `${errors} errors since last tick (threshold ${ruleConfig.threshold})`;
                }
                break;
              }
              case 'p95_latency': {
                let maxP95 = 0;
                if (routeKey) {
                  const value = currentSnapshot.get(routeKey);
                  if (value) maxP95 = p95(value);
                } else {
                  for (const value of currentSnapshot.values()) maxP95 = Math.max(maxP95, p95(value));
                }
                if (maxP95 >= ruleConfig.threshold) {
                  triggered = true;
                  details = `p95 latency ${maxP95.toFixed(0)}ms (threshold ${ruleConfig.threshold}ms)`;
                }
                break;
              }
              case 'dead_letter_depth': {
                let total = 0;
                for (const count of deadLetterDepths.values()) total += count;
                if (total >= ruleConfig.threshold) {
                  triggered = true;
                  details = `${total} dead-letter jobs (threshold ${ruleConfig.threshold})`;
                }
                break;
              }
              case 'quota_usage': {
                // Approximate: compare the last minute of observed requests against the per-project limit.
                // This is intentionally coarse; detailed billing quotas live outside the API.
                let total = 0;
                for (const value of currentSnapshot.values()) total += value.count;
                const quotaLimit = Number(process.env.QB_DEFAULT_REQUESTS_PER_MINUTE ?? 600);
                const usage = total / Math.max(1, quotaLimit);
                if (usage >= ruleConfig.threshold) {
                  triggered = true;
                  details = `Request volume ${Math.round(usage * 100)}% of ${quotaLimit}/min limit`;
                }
                break;
              }
              case 'backup_failure': {
                const count = (await db
                  .query(
                    "SELECT COUNT(*) AS c FROM recovery_findings WHERE project_id IN (SELECT id FROM projects WHERE org_id=?) AND resolved_at IS NULL",
                  )
                  .get(rule.org_id)) as any;
                if (Number(count?.c ?? 0) >= ruleConfig.threshold) {
                  triggered = true;
                  details = `${count.c} unresolved recovery findings (threshold ${ruleConfig.threshold})`;
                }
                break;
              }
              case 'snapshot_age': {
                const latest = (await db
                  .query(
                    'SELECT MAX(created_at) AS m FROM backups WHERE branch_id IN (SELECT id FROM branches WHERE project_id IN (SELECT id FROM projects WHERE org_id=?))',
                  )
                  .get(rule.org_id)) as any;
                const ageHours = latest?.m
                  ? (nowTime - Date.parse(latest.m)) / 3600000
                  : Number.POSITIVE_INFINITY;
                if (ageHours >= ruleConfig.threshold) {
                  triggered = true;
                  details = `Latest backup is ${ageHours >= 1000 ? 'over 1000' : ageHours.toFixed(1)} hours old (threshold ${ruleConfig.threshold}h)`;
                }
                break;
              }
            }
            if (!triggered) continue;
            const notificationId = crypto.randomUUID();
            const nowStr = now();
            await db
              .query('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?)')
              .run(
                notificationId,
                rule.org_id,
                rule.project_id,
                rule.severity,
                title,
                details,
                null,
                nowStr,
              );
            const silenceMinutes = Math.max(1, Math.min(1440, Number((config as any).silenceMinutes ?? 15)));
            const silencedUntilStr = new Date(nowTime + silenceMinutes * 60000).toISOString();
            await db
              .query(
                'INSERT INTO alert_states VALUES(?,?,?,?) ON CONFLICT(rule_id) DO UPDATE SET window_start=excluded.window_start,last_fired_at=excluded.last_fired_at,silenced_until=excluded.silenced_until',
              )
              .run(rule.id, windowStart, nowStr, silencedUntilStr);
            const channels = JSON.parse(rule.channels) as { type: 'email'; to: string }[];
            for (const channel of channels) {
              if (channel.type !== 'email') continue;
              const deliveryId = crypto.randomUUID();
              try {
                await mailer.sendAlert(channel.to, {
                  severity: rule.severity,
                  title,
                  details,
                  studioUrl,
                });
                await db
                  .query('INSERT INTO alert_deliveries VALUES(?,?,?,?,?)')
                  .run(deliveryId, rule.id, `email:${channel.to}`, 'sent', nowStr);
              } catch (err) {
                log({ action: 'alert.delivery_failed', code: rule.id });
                await db
                  .query('INSERT INTO alert_deliveries VALUES(?,?,?,?,?)')
                  .run(deliveryId, rule.id, `email:${channel.to}`, 'failed', nowStr);
              }
            }
          } catch (err) {
            log({ action: 'alert.evaluate_failed', code: rule.id });
          }
        }
        lastMetricsSnapshot = currentSnapshot;
      }
      {
        const request = new Request(config.publicURL + '/internal/maintenance');
        const branches = (await db
          .query(
            "SELECT b.*,p.org_id,p.config FROM branches b JOIN projects p ON p.id=b.project_id WHERE b.status='ready' AND p.status='ready'",
          )
          .all()) as any[];
        for (const b of branches) {
          const p = (await db.query('SELECT * FROM projects WHERE id=?').get(b.project_id)) as any;
          const existing = owners.has(b.id);
          if (!existing && owners.size >= config.maxBranchOwners) continue;
          const o = owner(p, b, false);
          try {
            try {
              await o.call('webhooks-produce');
            } catch (error) {
              // Delivery backpressure must not disable cleanup or scheduled recovery.
              // The producer transaction preserved its checkpoint for a later retry.
              if (!(error instanceof QBError) || error.code !== 'QUEUE_FULL') throw error;
              log({ action: 'webhooks.backpressure' });
            }
            await o.call('cleanup');
            cleaned++;
            try {
              const depth = (await o.call('dead-letter-depth')) as { kind: string; count: number }[];
              for (const { kind, count } of depth) {
                deadLetterDepths.set(kind, (deadLetterDepths.get(kind) ?? 0) + Number(count));
              }
            } catch {
              log({ action: 'alerts.dead_letter_depth.failed' });
            }
            const pending = await o.call('object-maintenance');
            for (const object of pending) {
              try {
                await backend.delete(`${p.id}/${b.id}/${object.id}`);
                await o.call('object-state', { id: object.id, state: 'deleted' });
              } catch {
                log({ action: 'storage.cleanup.failed' });
              }
            }
            if (b.name === 'main' && scheduledBackupsEnabled()) {
              const settings = await loadRecoverySettings(db, p.id);
              if (settings.enabled) {
                const latest = (await db
                  .query(
                    'SELECT created_at FROM backups WHERE branch_id=? ORDER BY created_at DESC LIMIT 1',
                  )
                  .get(b.id)) as any;
                const intervalMs = settings.intervalHours * 3600000;
                if (!latest || Date.parse(latest.created_at) < Date.now() - intervalMs) {
                  await backup(p, b, 'system', request);
                  backedUp++;
                }
                if (settings.drillIntervalHours > 0) {
                  const open = (await db
                    .query(
                      "SELECT id FROM recovery_drills WHERE project_id=? AND state IN('queued','restoring','validating') LIMIT 1",
                    )
                    .get(p.id)) as any;
                  const lastDrill = (await db
                    .query(
                      'SELECT created_at FROM recovery_drills WHERE project_id=? ORDER BY created_at DESC LIMIT 1',
                    )
                    .get(p.id)) as any;
                  const due =
                    !lastDrill ||
                    Date.parse(lastDrill.created_at) <
                      Date.now() - settings.drillIntervalHours * 3600000;
                  if (!open && due) {
                    const archive = (await db
                      .query(
                        `SELECT b.id FROM backups b
                         LEFT JOIN backup_replicas r ON r.backup_id=b.id AND r.state='verified'
                         WHERE b.branch_id=?
                         ORDER BY b.created_at DESC LIMIT 1`,
                      )
                      .get(b.id)) as any;
                    if (archive) {
                      await enqueueRecoveryDrill(p, b, archive.id, o, 'system', request);
                    }
                  }
                }
              }
              await applyRetention(db, p.id, settings, cipher, config.dataDir);
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
        if (scheduledBackupsEnabled()) {
          const folder = join(config.dataDir, 'backups', 'control');
          mkdirSync(folder, { recursive: true, mode: 0o700 });
          const files = readdirSync(folder)
            .filter((name) => name.endsWith('.sqlite.enc') || name.endsWith('.pglite.tar.enc'))
            .sort()
            .reverse();
          if (!files.some((name) => name.startsWith(now().slice(0, 10))))
            await writeControlSnapshot(db, config.dataDir, config.master);
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
        await evaluateAlerts();
        await db
          .query('DELETE FROM audit_events WHERE time<?')
          .run(new Date(Date.now() - 90 * 86400000).toISOString());
        for (const [id, time] of lastUsed)
          if (time < Date.now() - 600000) {
            await owners.get(id)?.close();
            owners.delete(id);
            lastUsed.delete(id);
          }
        return { cleaned, backedUp };
      }
    }
    let setupBusy = false;
    const limits = new Map<
      string,
      {
        count: number;
        reset: number;
      }
    >();
    const app = new Elysia({ serve: { maxRequestBodySize: 104857600 } })
      .onRequest(async ({ request, set }) => {
        starts.set(request, performance.now());
        set.headers['x-request-id'] =
          request.headers.get('x-request-id')?.slice(0, 100) ?? crypto.randomUUID();
        const origin = request.headers.get('origin');
        const path = new URL(request.url).pathname;
        let allowed = config.origins;
        let requestLimit = 600;
        const projectId = path.match(/^\/v1\/projects\/([^/]+)/)?.[1];
        if (projectId) {
          const project = (await db
            .query('SELECT config FROM projects WHERE id=?')
            .get(projectId)) as any;
          if (project) {
            const settings = cipher.open(project.config);
            allowed = settings.origins ? normalizeOrigins(settings.origins) : allowed;
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
        const objectUpload = request.method === 'PUT' && path.endsWith('/content');
        const avatarUpload = request.method === 'POST' && path === '/platform/avatar';
        if (avatarUpload && length > 3276800)
          throw new QBError('SIZE_LIMIT', 'Avatar uploads are limited to 3 MiB', 413);
        if (length > 65536 && !objectUpload && !avatarUpload)
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
      .onAfterHandle(({ request, set, response }) => {
        releaseTransfer(request);
        const durationMs = performance.now() - (starts.get(request) ?? performance.now());
        const status =
          response instanceof Response
            ? response.status
            : typeof set.status === 'number'
              ? set.status
              : 200;
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
      .get('/ready', async () => {
        await db.query('SELECT 1').get();
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
      .post('/internal/jobs/claim', async ({ request, body }) => {
        const kinds = executorKinds(request),
          input = body as any;
        const allowed =
          input?.executor === 'webhooks'
            ? kinds.filter((kind) => kind === 'webhook.delivery')
            : input?.executor === 'recovery'
              ? kinds.filter((kind) => kind === 'recovery.drill')
              : kinds;
        if (!allowed.length)
          throw new QBError('DENIED', 'Executor cannot claim the requested jobs', 403);
        return success(
          await (
            await executorTarget(input)
          ).call('jobs-claim', {
            kinds: allowed,
            leaseMs: Number.isInteger(input?.leaseMs) ? input.leaseMs : undefined,
          }),
          request,
        );
      })
      .post('/internal/recovery/execute', async ({ request, body }) => {
        internal(request);
        const input = body as any;
        if (!input || typeof input.drillId !== 'string' || typeof input.projectId !== 'string')
          throw new QBError('VALIDATION', 'Recovery execute requires drill and project identifiers');
        const p = (await db
          .query("SELECT * FROM projects WHERE id=? AND status='ready'")
          .get(input.projectId)) as any;
        if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
        if (activeBackups >= 2)
          throw new QBError(
            'BACKUP_BUSY',
            'Backup/restore capacity reached; retry later',
            503,
            true,
          );
        activeBackups++;
        try {
          return success(
            await executeDrill({
              db,
              drillId: input.drillId,
              project: p,
              dataDir: config.dataDir,
              master: config.master,
              cipher,
              backend,
              openOwner: (project, branch) => owner(project, branch, false),
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
            }),
            request,
          );
        } finally {
          activeBackups--;
        }
      })
      .get('/internal/jobs/targets', async ({ request }) => {
        executorKinds(request);
        return await controlList(
          'SELECT b.id AS "branchId",b.project_id AS "projectId",b.id FROM branch_job_targets t JOIN branches b ON b.id=t.branch_id JOIN projects p ON p.id=b.project_id WHERE b.status=\'ready\' AND p.status=\'ready\'',
          [],
          request,
          'executor-targets',
        );
      })
      .post('/internal/jobs/release', async ({ request, body }) => {
        internal(request);
        const input = body as any;
        if (!input || typeof input.projectId !== 'string' || typeof input.branchId !== 'string')
          throw new QBError('VALIDATION', 'Invalid executor target');
        const b = await branch(input.projectId, input.branchId);
        if (executorOnly.delete(b.id)) {
          const o = owners.get(b.id);
          await o?.close();
          if (owners.get(b.id) === o) {
            owners.delete(b.id);
            lastUsed.delete(b.id);
          }
        }
        return success({ released: true }, request);
      })
      .post('/internal/webhooks/prepare', async ({ request, body }) => {
        internal(request);
        const input = body as any,
          o = await executorTarget(input);
        const ref = await o.call('webhooks-reference', {
          id: input.id,
          leaseToken: input.leaseToken,
        });
        const denied = await webhookScope(
          input.projectId,
          input.branchId,
          ref.serviceKeyId,
          ref.table,
        );
        if (denied) return success({ skipped: true, code: denied }, request);
        return success(
          await o.call('webhooks-prepare', {
            id: input.id,
            leaseToken: input.leaseToken,
            serviceKeyId: ref.serviceKeyId,
          }),
          request,
        );
      })
      .post('/internal/webhooks/produce', async ({ request, body }) => {
        internal(request);
        return success(await (await executorTarget(body)).call('webhooks-produce'), request);
      })
      .post('/internal/jobs/finish', async ({ request, body }) => {
        const kinds = executorKinds(request),
          input = body as any;
        return success(
          await (
            await executorTarget(input)
          ).call('jobs-finish', {
            id: input.id,
            leaseToken: input.leaseToken,
            result: input.result,
            kinds,
          }),
          request,
        );
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
      .get('/setup', async ({ request }) => {
        const required = !(await db.query('SELECT id FROM _qb_auth_users LIMIT 1').get());
        // tokenSource names where the credential came from; it never exposes the value.
        return success({ required, tokenSource: required ? bootstrapState.source : 'none' }, request);
      })
      .post('/setup', async ({ body, request }) => {
        const input = body as any;
        if (!bootstrapTokenMatches(input.bootstrapToken, bootstrap))
          throw new QBError(
            'DENIED',
            'Valid bootstrap token required. Use the exact QB_BOOTSTRAP_TOKEN value configured for this API (set in its environment or .env file).',
            403,
          );
        if (setupBusy || (await db.query('SELECT id FROM _qb_auth_users LIMIT 1').get()))
          throw new QBError('SETUP_COMPLETE', 'First owner is already configured', 409);
        setupBusy = true;
        try {
          const result = await platform.api.signUpEmail({
            body: { email: input.email, password: input.password, name: input.name },
          });
          const id = crypto.randomUUID();
          await db.transaction(async (tx) => {
            await tx
              .query(
                'INSERT INTO organizations(id,name,created_at,image,archived_at,deleted_at) VALUES(?,?,?,?,NULL,NULL)',
              )
              .run(id, input.organization ?? 'Personal workspace', now(), '');
            await tx
              .query('INSERT INTO memberships VALUES(?,?,?)')
              .run(id, result.user.id, 'owner');
          })();
          // The env value stays in the deployment config; clearing it here only stops this process.
          bootstrap = undefined;
          return success({ organizationId: id }, request);
        } finally {
          setupBusy = false;
        }
      })
      .post('/platform/avatar', async ({ request }) => {
        const actor = await user(request);
        if (actor.tokenScope)
          throw new QBError('TOKEN_SCOPE', 'Use a platform session to update your avatar', 403);
        const form = await request.formData();
        const entry = form.get('file');
        // Bun/FormData may yield File or Blob; reject bare strings.
        if (
          !entry ||
          typeof entry === 'string' ||
          typeof (entry as Blob).arrayBuffer !== 'function'
        )
          throw new QBError('VALIDATION', 'Choose an image file to upload');
        const file = entry as Blob & {
          type?: string;
          name?: string;
        };
        const mime = String(file.type || '').toLowerCase();
        const allowed = new Map([
          ['image/jpeg', 'jpg'],
          ['image/png', 'png'],
          ['image/webp', 'webp'],
          ['image/gif', 'gif'],
        ]);
        const ext = allowed.get(mime);
        if (!ext) throw new QBError('VALIDATION', 'Use a JPEG, PNG, WebP, or GIF image');
        if (file.size < 1 || file.size > 3145728)
          throw new QBError('VALIDATION', 'Avatar must be between 1 byte and 3 MiB');
        const bytes = Buffer.from(await file.arrayBuffer());
        const folder = join(config.dataDir, 'platform-avatars');
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        for (const existing of readdirSync(folder)) {
          if (existing.startsWith(`${actor.id}.`)) unlinkSync(join(folder, existing));
        }
        const filename = `${actor.id}.${ext}`;
        writeFileSync(join(folder, filename), bytes, { mode: 0o600 });
        const image = `${config.publicURL}/platform/avatars/${actor.id}?v=${Date.now()}`;
        // Persist on the platform user row directly. Forwarding the multipart
        // request into Better Auth updateUser corrupts the session body parse.
        const updated = await db
          .query('UPDATE _qb_auth_users SET image=? WHERE id=?')
          .run(image, actor.id);
        if (!updated.changes) {
          try {
            unlinkSync(join(folder, filename));
          } catch {
            /* best-effort cleanup */
          }
          throw new QBError('NOT_FOUND', 'Platform user not found', 404);
        }
        await audit(actor.id, 'platform.avatar.upload', 'user:' + actor.id, null, request, 'ok');
        return success({ image }, request);
      })
      .delete('/platform/avatar', async ({ request }) => {
        const actor = await user(request);
        if (actor.tokenScope)
          throw new QBError('TOKEN_SCOPE', 'Use a platform session to update your avatar', 403);
        const folder = join(config.dataDir, 'platform-avatars');
        if (existsSync(folder)) {
          for (const existing of readdirSync(folder)) {
            if (existing.startsWith(`${actor.id}.`)) unlinkSync(join(folder, existing));
          }
        }
        await db.query('UPDATE _qb_auth_users SET image=? WHERE id=?').run(null, actor.id);
        await audit(actor.id, 'platform.avatar.delete', 'user:' + actor.id, null, request, 'ok');
        return success({ image: null }, request);
      })
      .get('/platform/avatars/:userId', ({ params, set }) => {
        const userId = String(params.userId ?? '');
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId))
          throw new QBError('NOT_FOUND', 'Avatar not found', 404);
        const folder = join(config.dataDir, 'platform-avatars');
        if (!existsSync(folder)) throw new QBError('NOT_FOUND', 'Avatar not found', 404);
        const match = readdirSync(folder).find((name) => name.startsWith(`${userId}.`));
        if (!match) throw new QBError('NOT_FOUND', 'Avatar not found', 404);
        const ext = match.slice(userId.length + 1);
        const types: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
          gif: 'image/gif',
        };
        const type = types[ext];
        if (!type) throw new QBError('NOT_FOUND', 'Avatar not found', 404);
        set.headers['content-type'] = type;
        set.headers['cache-control'] = 'public, max-age=3600';
        return new Response(readFileSync(join(folder, match)), {
          headers: {
            'content-type': type,
            'cache-control': 'public, max-age=3600',
          },
        });
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
          const account = (await db
            .query('SELECT "twoFactorEnabled" FROM _qb_auth_users WHERE id=?')
            .get(before.user.id)) as any;
          if (account?.twoFactorEnabled) {
            const newToken = response.headers.get('set-auth-token');
            if (newToken)
              await db
                .query('DELETE FROM _qb_auth_sessions WHERE "userId"=? AND token<>?')
                .run(before.user.id, newToken);
            await db
              .query(
                'UPDATE management_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
              )
              .run(now(), before.user.id);
          }
        }
        return response;
      })
      .get('/management/v1/capabilities', ({ request }) =>
        success(
          {
            ...capabilities,
            storage: process.env.QB_S3_ENDPOINT ? 'available' : 'unconfigured',
            assistant:
              process.env.QB_AI_BASE_URL &&
              process.env.QB_AI_API_KEY &&
              process.env.QB_AI_MODEL
                ? 'available'
                : 'unconfigured',
          },
          request,
        ),
      )
      .get('/management/v1/organizations', async ({ request }) => {
        const actor = await user(request);
        const scope = actor.tokenScope?.organizations as string[] | undefined;
        return await controlList(
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
          !(
            (await db
              .query('SELECT "twoFactorEnabled" FROM _qb_auth_users WHERE id=?')
              .get(actor.id)) as any
          )?.twoFactorEnabled
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
        await db.transaction(async (tx) => {
          await tx
            .query(
              'INSERT INTO organizations(id,name,created_at,image,archived_at,deleted_at) VALUES(?,?,?,?,NULL,NULL)',
            )
            .run(id, name, now(), '');
          await tx.query('INSERT INTO memberships VALUES(?,?,?)').run(id, actor.id, 'owner');
        })();
        await audit(actor.id, 'organization.create', id, { org_id: id }, request);
        return success({ id, name, image: '', archived_at: null }, request);
      })
      .get('/management/v1/organizations/:id', async ({ params, request }) => {
        const actor = await user(request);
        await member(params.id, actor.id);
        const org = (await db
          .query('SELECT * FROM organizations WHERE id=?')
          .get(params.id)) as any;
        if (!org) throw new QBError('NOT_FOUND', 'Workspace not available', 404);
        return success(org, request);
      })
      .patch('/management/v1/organizations/:id', async ({ params, request, body }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'admin');
        const org = (await db
          .query('SELECT * FROM organizations WHERE id=?')
          .get(params.id)) as any;
        if (!org) throw new QBError('NOT_FOUND', 'Workspace not available', 404);
        const input = body as any;
        const name = input.name === undefined ? org.name : String(input.name ?? '').trim();
        if (!name) throw new QBError('VALIDATION', 'Workspace name is required');
        if (name.length > 100)
          throw new QBError('VALIDATION', 'Workspace name is at most 100 characters');
        const image =
          input.image === null ? '' : input.image === undefined ? org.image : String(input.image);
        if (image && !/^data:image\/(?:png|jpeg|webp);base64,/.test(image))
          throw new QBError('VALIDATION', 'Provide a PNG, JPEG or WebP image data URI');
        if (image.length > 1536000) throw new QBError('VALIDATION', 'Image must be under 1.5 MB');
        await db
          .query('UPDATE organizations SET name=?,image=? WHERE id=?')
          .run(name, image, params.id);
        await audit(actor.id, 'workspace.update', params.id, { org_id: params.id }, request);
        return success({ name, image }, request);
      })
      .post('/management/v1/organizations/:id/archive', async ({ params, request }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'admin');
        await db.query('UPDATE organizations SET archived_at=? WHERE id=?').run(now(), params.id);
        await audit(actor.id, 'workspace.archive', params.id, { org_id: params.id }, request);
        return success({ archived: true }, request);
      })
      .post('/management/v1/organizations/:id/unarchive', async ({ params, request }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'admin');
        await db.query('UPDATE organizations SET archived_at=NULL WHERE id=?').run(params.id);
        await audit(actor.id, 'workspace.unarchive', params.id, { org_id: params.id }, request);
        return success({ archived: false }, request);
      })
      .delete('/management/v1/organizations/:id', async ({ params, request, set }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'owner');
        // Isolated cleanup: only projects under this organization, their branch dirs,
        // function trees, backup files, and storage keys under project/branch prefixes.
        await deleteWorkspaceArtifacts(params.id);
        set.status = 204;
        return '';
      })
      .get('/management/v1/organizations/:id/members', async ({ params, request }) => {
        const actor = await user(request);
        await member(params.id, actor.id);
        return success(
          await db
            .query(
              'SELECT m.user_id,m.role,u.email,u.name FROM memberships m JOIN _qb_auth_users u ON u.id=m.user_id WHERE m.org_id=?',
            )
            .all(params.id),
          request,
        );
      })
      .post('/management/v1/organizations/:id/members', async ({ params, request, body }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'admin');
        const input = body as any;
        if (!['admin', 'developer', 'viewer'].includes(input.role))
          throw new QBError('VALIDATION', 'Invalid member role');
        const account = (await db
          .query('SELECT id FROM _qb_auth_users WHERE email=?')
          .get(input.email)) as any;
        if (!account)
          throw new QBError('NOT_FOUND', 'Create the invited platform account first', 404);
        const existingRole = (await db
          .query('SELECT role FROM memberships WHERE org_id=? AND user_id=?')
          .get(params.id, account.id)) as any;
        if (existingRole?.role === 'owner')
          throw new QBError(
            'DENIED',
            'Ownership transfer requires an explicit owner workflow',
            403,
          );
        await db
          .query(
            'INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role',
          )
          .run(params.id, account.id, input.role);
        await audit(actor.id, 'membership.update', account.id, { org_id: params.id }, request);
        return success({ userId: account.id, role: input.role }, request);
      })
      .post('/management/v1/invitations', async ({ request, body }) => {
        const actor = await user(request);
        const input = body as any;
        await member(input.organizationId, actor.id, 'admin');
        const account = await platform.api.signUpEmail({
          body: { name: input.name, email: input.email, password: input.temporaryPassword },
        });
        await db
          .query('INSERT INTO memberships VALUES(?,?,?)')
          .run(
            input.organizationId,
            account.user.id,
            ['admin', 'developer', 'viewer'].includes(input.role) ? input.role : 'viewer',
          );
        await audit(
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
          await member(org, actor.id, input?.readOnly ? 'viewer' : 'developer');
        const projects = Array.isArray(input?.projects)
          ? input.projects
          : (
              await db
                .query(
                  'SELECT p.id FROM projects p JOIN memberships m ON m.org_id=p.org_id WHERE m.user_id=?',
                )
                .all(actor.id)
            ).map((p: any) => p.id);
        for (const id of projects)
          await projectAccess(request, id, input?.readOnly ? 'viewer' : 'developer');
        const token = 'qb_mt_' + randomBytes(32).toString('base64url');
        const id = crypto.randomUUID();
        await db.transaction(async (tx) => {
          await tx
            .query('INSERT INTO management_tokens VALUES(?,?,?,?,NULL)')
            .run(id, actor.id, sha(token), new Date(Date.now() + 86400000 * 30).toISOString());
          await tx
            .query('INSERT INTO token_scopes VALUES(?,?)')
            .run(
              id,
              JSON.stringify({ projects, organizations, readOnly: input?.readOnly === true }),
            );
        })();
        await audit(actor.id, 'management-token.create', id, null, request);
        return success({ id, token, projects, organizations }, request);
      })
      .get('/management/v1/tokens', async ({ request }) => {
        const actor = await user(request);
        return success(
          await db
            .query('SELECT id,expires_at,revoked_at FROM management_tokens WHERE user_id=?')
            .all(actor.id),
          request,
        );
      })
      .delete('/management/v1/tokens/:token', async ({ request, params }) => {
        const actor = await user(request);
        await db
          .query('UPDATE management_tokens SET revoked_at=? WHERE id=? AND user_id=?')
          .run(now(), params.token, actor.id);
        return success({ revoked: true }, request);
      })
      .get('/management/v1/projects', async ({ request }) => {
        const actor = await user(request);
        const scope = actor.tokenScope?.projects as string[] | undefined;
        return await controlList(
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
        await member(input.organizationId, actor.id, 'developer');
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
          const old = (await db
            .query('SELECT * FROM management_idempotency WHERE scope=?')
            .get(scope)) as any;
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
        await db.transaction(async (tx) => {
          await tx
            .query('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)')
            .run(
              id,
              input.organizationId,
              input.name,
              input.slug,
              'provisioning',
              'local',
              cipher.seal({ origins: config.origins, providers: {}, verifyEmail: false }),
              now(),
            );
          await tx
            .query(
              'INSERT INTO branches(id,project_id,name,status,generation,created_at,kind) VALUES(?,?,?,?,?,?,?)',
            )
            .run(bid, id, 'main', 'provisioning', 1, now(), 'primary');
          await tx
            .query('INSERT INTO operations VALUES(?,?,?,?,?,?,?)')
            .run(operationId, id, 'provision', 'requested', 0, null, now());
          if (scope)
            await tx
              .query('INSERT INTO management_idempotency VALUES(?,?,?)')
              .run(scope, digest, JSON.stringify(result));
        })();
        await audit(actor.id, 'project.create', id, { id, org_id: input.organizationId }, request);
        set.status = 202;
        return success(result, request);
      })
      .patch('/management/v1/projects/:id', async ({ request, params, body }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        const input = body as { name?: unknown; region?: unknown };
        if (input?.name === undefined && input?.region === undefined)
          throw new QBError('VALIDATION', 'Provide a project name or region');
        const name = input?.name === undefined ? String(p.name) : String(input.name ?? '').trim();
        if (!name || name.length > 100)
          throw new QBError('VALIDATION', 'Project name is required and at most 100 characters');
        const region =
          input?.region === undefined ? String(p.region) : String(input.region ?? '').trim();
        if (input?.region !== undefined && region !== 'local')
          throw new QBError('VALIDATION', 'This release places projects in the local region');
        await db.query('UPDATE projects SET name=?,region=? WHERE id=?').run(name, region, p.id);
        await audit(actor.id, 'project.update', p.id, { id: p.id, org_id: p.org_id }, request);
        return success({ id: p.id, name, slug: p.slug, region, status: p.status }, request);
      })
      .delete('/management/v1/projects/:id', async ({ request, params, set }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        // Isolated cleanup: only this project's branches, storage prefix, functions, and catalog rows.
        await deleteProjectArtifacts(p);
        await audit(actor.id, 'project.delete', p.id, { id: p.id, org_id: p.org_id }, request);
        set.status = 204;
        return '';
      })
      .get('/management/v1/operations/:id', async ({ request, params }) => {
        const row = (await db.query('SELECT * FROM operations WHERE id=?').get(params.id)) as any;
        if (!row) throw new QBError('NOT_FOUND', 'Operation not available', 404);
        await projectAccess(request, row.project_id);
        return success(row, request);
      })
      .post('/management/v1/operations/:id/cancel', async ({ request, params }) => {
        const operation = (await db
          .query('SELECT * FROM operations WHERE id=?')
          .get(params.id)) as any;
        if (!operation) throw new QBError('NOT_FOUND', 'Operation not available', 404);
        const { p, actor } = await projectAccess(request, operation.project_id, 'developer');
        if (operation.status === 'cancelled') return success(operation, request);
        if (operation.status !== 'requested')
          throw new QBError(
            'OPERATION_NOT_CANCELLABLE',
            'Only provisioning operations that have not started can be cancelled',
            409,
          );
        await db.transaction(async (tx) => {
          await tx
            .query("UPDATE operations SET status='cancelled' WHERE id=? AND status='requested'")
            .run(operation.id);
          await tx.query("UPDATE projects SET status='cancelled' WHERE id=?").run(p.id);
          await tx.query("UPDATE branches SET status='cancelled' WHERE project_id=?").run(p.id);
        })();
        await audit(actor.id, 'operation.cancel', operation.id, p, request);
        return success({ id: operation.id, status: 'cancelled' }, request);
      })
      .get('/management/v1/projects/:id/branches', async ({ request, params }) => {
        const { actor } = await projectAccess(request, params.id);
        return await controlList(
          'SELECT * FROM branches WHERE project_id=?',
          [params.id],
          request,
          actor.id,
        );
      })
      .get('/management/v1/projects/:id/previews', async ({ request, params }) => {
        await projectAccess(request, params.id);
        const rows = (await db
          .query(
            "SELECT * FROM branches WHERE project_id=? AND kind='preview' ORDER BY created_at DESC LIMIT 100",
          )
          .all(params.id)) as any[];
        return success(
          rows.map((row) =>
            previewSummary({
              ...row,
              expires_at: row.expires_at,
              error: row.error,
            }),
          ),
          request,
        );
      })
      .post('/management/v1/projects/:id/previews', async ({ request, params, body, set }) => {
        const { p, actor } = await projectAccess(request, params.id, 'developer');
        const input = (body ?? {}) as {
          name?: string;
          fixtures?: Record<string, Record<string, unknown>[]>;
          ttlHours?: number;
        };
        const ttl = previewTtlHours(input.ttlHours);
        const id = crypto.randomUUID();
        const name =
          (typeof input.name === 'string' && input.name.trim()) ||
          'preview-' + id.slice(0, 8);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(name))
          throw new QBError('VALIDATION', 'Invalid preview name');
        const existing = (await db
          .query("SELECT count(*) AS n FROM branches WHERE project_id=? AND kind='preview' AND status NOT IN('deleted','failed')")
          .get(p.id)) as { n: number | bigint };
        if (Number(existing.n) >= 10)
          throw new QBError('LIMIT_EXCEEDED', 'At most 10 active previews per project');
        const expiresAt = new Date(Date.now() + ttl * 3600_000).toISOString();
        const operationId = crypto.randomUUID();
        await db.transaction(async (tx) => {
          await tx
            .query(
              'INSERT INTO branches(id,project_id,name,status,generation,created_at,kind,expires_at,error) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .run(id, p.id, name, 'queued', 1, now(), 'preview', expiresAt, null);
          await tx
            .query('INSERT INTO operations VALUES(?,?,?,?,?,?,?)')
            .run(operationId, p.id, 'preview', 'requested', 0, null, now());
        })();
        // Provision from primary schema/policies only; never copy rows, users, sessions, webhooks, or jobs.
        try {
          await db.query("UPDATE branches SET status='provisioning' WHERE id=?").run(id);
          await db
            .query("UPDATE operations SET status='running',progress=25 WHERE id=?")
            .run(operationId);
          const primary = await branch(p.id, 'primary');
          await owner(p, primary).call('preview-provision', {
            path: previewPath(config.dataDir, p.id, id),
            fixtures: input.fixtures ?? {},
          });
          await db.transaction(async (tx) => {
            await tx.query("UPDATE branches SET status='ready',error=NULL WHERE id=?").run(id);
            await tx
              .query("UPDATE operations SET status='succeeded',progress=100 WHERE id=?")
              .run(operationId);
          })();
        } catch (error) {
          const message =
            error instanceof Error ? error.message.slice(0, 500) : 'Preview provisioning failed';
          rmSync(previewPath(config.dataDir, p.id, id), { recursive: true, force: true });
          await db
            .query("UPDATE branches SET status='failed',error=? WHERE id=?")
            .run(message, id);
          await db
            .query("UPDATE operations SET status='failed',error=? WHERE id=?")
            .run(message, operationId);
        }
        const row = (await db.query('SELECT * FROM branches WHERE id=?').get(id)) as any;
        await audit(actor.id, 'preview.create', id, p, request);
        set.status = 202;
        return success(previewSummary(row), request);
      })
      .get('/management/v1/projects/:id/previews/:preview', async ({ request, params }) => {
        await projectAccess(request, params.id);
        const row = (await db
          .query("SELECT * FROM branches WHERE id=? AND project_id=? AND kind='preview'")
          .get(params.preview, params.id)) as any;
        if (!row) throw new QBError('NOT_FOUND', 'Preview not found', 404);
        return success(previewSummary(row), request);
      })
      .post(
        '/management/v1/projects/:id/previews/:preview/extend',
        async ({ request, params, body }) => {
          const { p, actor } = await projectAccess(request, params.id, 'developer');
          const row = (await db
            .query("SELECT * FROM branches WHERE id=? AND project_id=? AND kind='preview'")
            .get(params.preview, params.id)) as any;
          if (!row) throw new QBError('NOT_FOUND', 'Preview not found', 404);
          if (!['ready', 'expiring'].includes(row.status))
            throw new QBError('CONFLICT', 'Preview cannot be extended', 409);
          const ttl = previewTtlHours((body as any)?.ttlHours);
          const created = Date.parse(row.created_at);
          const maxExpiry = created + 7 * 24 * 3600_000;
          const next = Math.min(Date.now() + ttl * 3600_000, maxExpiry);
          if (next <= Date.now())
            throw new QBError('VALIDATION', 'Preview has reached the 7-day maximum');
          await db
            .query("UPDATE branches SET expires_at=?,status='ready' WHERE id=?")
            .run(new Date(next).toISOString(), row.id);
          await audit(actor.id, 'preview.extend', row.id, p, request);
          return success(
            previewSummary({
              ...(await db.query('SELECT * FROM branches WHERE id=?').get(row.id)),
            } as any),
            request,
          );
        },
      )
      .delete('/management/v1/projects/:id/previews/:preview', async ({ request, params, set }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        const row = (await db
          .query("SELECT * FROM branches WHERE id=? AND project_id=? AND kind='preview'")
          .get(params.preview, params.id)) as any;
        if (!row) throw new QBError('NOT_FOUND', 'Preview not found', 404);
        await db.query("UPDATE branches SET status='deleting' WHERE id=?").run(row.id);
        try {
          if (owners.has(row.id)) {
            await owners.get(row.id)!.close();
            owners.delete(row.id);
          }
          rmSync(previewPath(config.dataDir, p.id, row.id), { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        await db.query("UPDATE branches SET status='deleted' WHERE id=?").run(row.id);
        await audit(actor.id, 'preview.delete', row.id, p, request);
        set.status = 204;
        return '';
      })
      .get('/management/v1/projects/:id/keys', async ({ request, params }) => {
        const { actor } = await projectAccess(request, params.id);
        return await controlList(
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
        await db
          .query('INSERT INTO project_keys VALUES(?,?,?,?,?,?,NULL)')
          .run(id, p.id, scope, sha(key), key.slice(0, 15), input?.expiresAt ?? null);
        await db.query('INSERT INTO project_key_metadata VALUES(?,?)').run(id, now());
        if (scope === 'service')
          await db.query('INSERT INTO credential_scopes VALUES(?,?)').run(
            id,
            JSON.stringify({
              branch: input.branch,
              tables: input.tables,
              methods: input.methods,
              bypass: input.bypass === true,
            }),
          );
        await audit(actor.id, 'key.create', id, p, request);
        return success({ id, key }, request);
      })
      .delete('/management/v1/projects/:id/keys/:key', async ({ request, params }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        await db
          .query('UPDATE project_keys SET revoked_at=? WHERE id=? AND project_id=?')
          .run(now(), params.key, p.id);
        await audit(actor.id, 'key.revoke', params.key, p, request);
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
                (await db
                  .query('SELECT version FROM project_config_versions WHERE project_id=?')
                  .get(p.id)) as any
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
            (await db
              .query('SELECT version FROM project_config_versions WHERE project_id=?')
              .get(p.id)) as any
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
            'Quotas require positive BIGINT databaseBytes, storageBytes or requestsPerMinute',
          );
        const next = {
          ...old,
          origins: input.origins ?? old.origins,
          verifyEmail: input.verifyEmail ?? old.verifyEmail,
          quotas: { ...old.quotas, ...input.quotas },
          providers: { ...old.providers, ...input.providers },
        };
        await db.transaction(async (tx) => {
          await tx.query('UPDATE projects SET config=? WHERE id=?').run(cipher.seal(next), p.id);
          await tx
            .query(
              'INSERT INTO project_config_versions VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET version=excluded.version',
            )
            .run(p.id, version + 1);
        })();
        for (const b of (await db
          .query('SELECT id FROM branches WHERE project_id=?')
          .all(p.id)) as any[])
          if (owners.has(b.id)) {
            await owners.get(b.id)!.close();
            owners.delete(b.id);
          }
        await audit(actor.id, 'config.update', p.id, p, request);
        return success({ updated: true, version: version + 1 }, request);
      })
      .put('/management/v1/projects/:id/secrets/:name', async ({ request, params, body }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(params.name) || typeof (body as any).value !== 'string')
          throw new QBError('VALIDATION', 'Provide an uppercase secret name and string value');
        const id = crypto.randomUUID();
        await db
          .query('INSERT INTO secret_versions VALUES(?,?,?,?,?)')
          .run(id, p.id, params.name, cipher.seal({ value: (body as any).value }), now());
        await audit(actor.id, 'secret.rotate', params.name, p, request);
        return success({ id, name: params.name }, request);
      })
      .get('/management/v1/projects/:id/secrets', async ({ request, params }) => {
        await projectAccess(request, params.id, 'admin');
        return success(
          await db
            .query(
              'SELECT name,MAX(created_at) AS "updatedAt" FROM secret_versions WHERE project_id=? GROUP BY name',
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
          await audit(actor.id, 'row.insert', params.table, p, request);
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
          await audit(actor.id, 'row.update', params.table, p, request);
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
          await audit(actor.id, 'row.delete', params.table, p, request);
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
          if (input.reviewId) {
            const result = await o.call('migration', {
              reviewId: input.reviewId,
              author: actor.id,
            });
            await audit(actor.id, 'migration.apply', input.reviewId, p, request);
            return success(result, request);
          }
          if (/\b(drop|alter|delete)\b/i.test(input.sql ?? ''))
            await backup(p, b, actor.id, request);
          const result = await o.call('migration', { ...input, author: actor.id });
          await audit(actor.id, 'migration.apply', input.id, p, request);
          return success(result, request);
        },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/reviews',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(await o.call('reviews-list'), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/reviews',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('reviews-create', { ...(body as object), author: actor.id });
          await audit(actor.id, 'review.create', result.id, p, request);
          return success(result, request);
        },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/reviews/:review',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(await o.call('reviews-get', { id: params.review }), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/reviews/:review/rehearse',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('reviews-rehearse', { id: params.review });
          await audit(actor.id, 'review.rehearse', params.review, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/reviews/:review/approve',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('reviews-approve', { id: params.review });
          await audit(actor.id, 'review.approve', params.review, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/reviews/:review/reject',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('reviews-reject', { id: params.review });
          await audit(actor.id, 'review.reject', params.review, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/policies/access',
        async ({ request, params, body }) => {
          const { o } = await management(request, params.id, params.branch, 'developer');
          return success(await o.call('policies-access', body), request);
        },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/search/collections',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(await o.call('search-collections-list'), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/search/collections',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('search-collections-create', body);
          await audit(actor.id, 'search.create', result.id, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/search/collections/:collection/rebuild',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('search-collections-rebuild', { id: params.collection });
          await audit(actor.id, 'search.rebuild', params.collection, p, request);
          return success(result, request);
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/search/collections/:collection',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('search-collections-delete', { id: params.collection });
          await audit(actor.id, 'search.delete', params.collection, p, request);
          return success(result, request);
        },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/inspector/samples',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(await o.call('inspector-samples'), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/inspector/plan',
        async ({ request, params, body }) => {
          const { o } = await management(request, params.id, params.branch, 'developer');
          return success(await o.call('inspector-plan', body), request);
        },
      )
      .get(
        '/management/v1/projects/:id/branches/:branch/realtime/debug',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(await o.call('realtime-debug-list'), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/realtime/debug',
        async ({ request, params, body }) => {
          const { o } = await management(request, params.id, params.branch, 'developer');
          return success(await o.call('realtime-debug-open', body), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/assistant',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('assistant', { ...(body as object), author: actor.id });
          await audit(actor.id, 'assistant.propose', p.id, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/webhooks/:webhook/sample',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch, 'developer');
          return success(await o.call('webhooks-sample', { id: params.webhook }), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/webhooks/:webhook/deliver-sample',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const sample = await o.call('webhooks-sample', { id: params.webhook });
          const result = await deliverWebhook(
            {
              skipped: false,
              url: sample.url,
              body: sample.body,
              headers: sample.headers,
            },
            { allowlist: webhookAllowlist },
          );
          await audit(actor.id, 'webhook.sample_deliver', params.webhook, p, request);
          return success(
            {
              delivered: result.success,
              status: result.success ? 200 : null,
              skipped: !result.success,
              code: result.success ? null : result.code,
            },
            request,
          );
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
          await audit(actor.id, 'sql.execute', b.id, p, request);
          return success(result, request);
        },
      )
      .get('/management/v1/projects/:id/branches/:branch/policies', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch);
        return success(await o.call('policies'), request);
      })
      .get('/management/v1/projects/:id/branches/:branch/webhooks', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch);
        return success(await o.call('webhooks-list'), request);
      })
      .get('/management/v1/projects/:id/branches/:branch/security', async ({ request, params }) => {
        const { o, p } = await management(request, params.id, params.branch);
        return success(
          await o.call('security-scan', { additional: await controlFindings(db, p.id, p.org_id) }),
          request,
        );
      })
      .post(
        '/management/v1/projects/:id/branches/:branch/security/:finding/acknowledge',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const result = await o.call('security-acknowledge', {
            id: params.finding,
            expiresAt: (body as any)?.expiresAt,
            actor: actor.id,
            additional: await controlFindings(db, p.id, p.org_id),
          });
          await audit(actor.id, 'security.acknowledge', params.finding, p, request);
          return success(result, request);
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/security/:finding/acknowledge',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const result = await o.call('security-clear', { id: params.finding });
          await audit(actor.id, 'security.clear', params.finding, p, request);
          return success(result, request);
        },
      )
      .get('/management/v1/organizations/:id/alert-rules', async ({ request, params }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'viewer');
        const rows = (await db
          .query(
            'SELECT id,org_id,project_id,name,kind,config,severity,channels,enabled,created_by,created_at,updated_at FROM alert_rules WHERE org_id=? ORDER BY updated_at DESC',
          )
          .all(params.id)) as any[];
        return success(
          rows.map((r) => ({
            id: r.id,
            orgId: r.org_id,
            projectId: r.project_id,
            name: r.name,
            kind: r.kind,
            config: JSON.parse(r.config),
            severity: r.severity,
            channels: JSON.parse(r.channels),
            enabled: Boolean(r.enabled),
            createdBy: r.created_by,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          })),
          request,
        );
      })
      .post('/management/v1/organizations/:id/alert-rules', async ({ request, params, body }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'admin');
        const input = body as any;
        const id = crypto.randomUUID();
        const nowStr = now();
        const channels = Array.isArray(input?.channels) ? input.channels : [];
        if (!input?.name || typeof input.name !== 'string' || input.name.length > 120)
          throw new QBError('VALIDATION', 'Alert rule name is required (max 120 chars)');
        if (!isValidAlertKind(input?.kind)) throw new QBError('VALIDATION', 'Invalid alert kind');
        if (!isValidAlertSeverity(input?.severity))
          throw new QBError('VALIDATION', 'Invalid alert severity');
        for (const ch of channels) {
          if (ch?.type !== 'email' || typeof ch?.to !== 'string' || !ch.to.includes('@'))
            throw new QBError('VALIDATION', 'Each channel must be an email object with a valid to address');
        }
        if (input?.projectId) {
          const proj = (await db.query('SELECT org_id FROM projects WHERE id=?').get(input.projectId)) as any;
          if (!proj || proj.org_id !== params.id)
            throw new QBError('VALIDATION', 'Project does not belong to this organization');
        }
        const ruleConfig = input?.config && typeof input.config === 'object' ? input.config : {};
        if (typeof ruleConfig.threshold !== 'number' || !Number.isFinite(ruleConfig.threshold))
          throw new QBError('VALIDATION', 'Alert config threshold must be a finite number');
        await db
          .query(
            'INSERT INTO alert_rules VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            params.id,
            input.projectId ?? null,
            input.name,
            input.kind,
            JSON.stringify(ruleConfig),
            input.severity,
            JSON.stringify(channels),
            input.enabled === false ? 0 : 1,
            actor.id,
            nowStr,
            nowStr,
          );
        await audit(actor.id, 'alert-rule.create', id, { id: input.projectId ?? null, org_id: params.id }, request);
        return success(
          {
            id,
            orgId: params.id,
            projectId: input.projectId ?? null,
            name: input.name,
            kind: input.kind,
            config: ruleConfig,
            severity: input.severity,
            channels,
            enabled: input.enabled !== false,
            createdBy: actor.id,
            createdAt: nowStr,
            updatedAt: nowStr,
          },
          request,
        );
      })
      .get('/management/v1/organizations/:id/alert-rules/:rule', async ({ request, params }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'viewer');
        const r = (await db
          .query(
            'SELECT id,org_id,project_id,name,kind,config,severity,channels,enabled,created_by,created_at,updated_at FROM alert_rules WHERE id=? AND org_id=?',
          )
          .get(params.rule, params.id)) as any;
        if (!r) throw new QBError('NOT_FOUND', 'Alert rule not found', 404);
        return success(
          {
            id: r.id,
            orgId: r.org_id,
            projectId: r.project_id,
            name: r.name,
            kind: r.kind,
            config: JSON.parse(r.config),
            severity: r.severity,
            channels: JSON.parse(r.channels),
            enabled: Boolean(r.enabled),
            createdBy: r.created_by,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          },
          request,
        );
      })
      .delete('/management/v1/organizations/:id/alert-rules/:rule', async ({ request, params, set }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'admin');
        const existing = (await db
          .query('SELECT project_id FROM alert_rules WHERE id=? AND org_id=?')
          .get(params.rule, params.id)) as any;
        if (!existing) throw new QBError('NOT_FOUND', 'Alert rule not found', 404);
        await db.query('DELETE FROM alert_rules WHERE id=? AND org_id=?').run(params.rule, params.id);
        await audit(actor.id, 'alert-rule.delete', params.rule, { id: existing.project_id ?? null, org_id: params.id }, request);
        set.status = 204;
        return null;
      })
      .get('/management/v1/organizations/:id/notifications', async ({ request, params }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'viewer');
        const rows = (await db
          .query(
            'SELECT id,org_id,project_id,severity,title,body,read_at,created_at FROM notifications WHERE org_id=? ORDER BY created_at DESC LIMIT 200',
          )
          .all(params.id)) as any[];
        return success(
          rows.map((r) => ({
            id: r.id,
            orgId: r.org_id,
            projectId: r.project_id,
            severity: r.severity,
            title: r.title,
            body: r.body,
            readAt: r.read_at,
            createdAt: r.created_at,
          })),
          request,
        );
      })
      .post('/management/v1/organizations/:id/notifications/:notification/read', async ({ request, params }) => {
        const actor = await user(request);
        await member(params.id, actor.id, 'viewer');
        const nowStr = now();
        const result = await db
          .query('UPDATE notifications SET read_at=? WHERE id=? AND org_id=? AND read_at IS NULL')
          .run(nowStr, params.notification, params.id);
        if (result.changes === 0)
          throw new QBError('NOT_FOUND', 'Notification not found or already read', 404);
        return success({ id: params.notification, readAt: nowStr }, request);
      })
      .post(
        '/management/v1/projects/:id/branches/:branch/webhooks',
        async ({ request, params, body }) => {
          const { o, b, p, actor } = await management(request, params.id, params.branch, 'admin');
          const input = body as any,
            url = webhookURL(input?.url);
          // Literal IPs are validated immediately; DNS policy is checked/pinned on each dispatch.
          const host = url.hostname.replace(/^\[|\]$/g, '');
          if (isIP(host) && !webhookAllowlist[url.origin] && !publicAddress(host))
            throw new QBError('DESTINATION_DENIED', 'Webhook destination is not public', 400);
          const denied = await webhookScope(p.id, b.id, input.serviceKeyId, input.table);
          if (denied)
            throw new QBError(
              denied,
              'Webhook requires an active non-bypass GET key scoped to this immutable branch and table',
              403,
            );
          // Write the poll marker first: a crash cannot hide a successfully committed subscription.
          await db
            .query('INSERT INTO branch_job_targets VALUES(?) ON CONFLICT DO NOTHING')
            .run(b.id);
          const result = await o.call('webhooks-create', input);
          await audit(actor.id, 'webhook.create', result.id, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/webhooks/:webhook/state',
        async ({ request, params, body }) => {
          const { o, p, b, actor } = await management(request, params.id, params.branch, 'admin');
          const result = await o.call('webhooks-state', {
            id: params.webhook,
            state: (body as any)?.state,
          });
          const remaining = await o.call('webhooks-list');
          if (!remaining.some((hook: any) => hook.state !== 'revoked'))
            await db.query('DELETE FROM branch_job_targets WHERE branch_id=?').run(b.id);
          await audit(actor.id, 'webhook.state', params.webhook, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/webhooks/:webhook/rotate',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const result = await o.call('webhooks-rotate', { id: params.webhook });
          await audit(actor.id, 'webhook.rotate', params.webhook, p, request);
          return success(result, request);
        },
      )
      .get('/management/v1/projects/:id/branches/:branch/jobs', async ({ request, params }) => {
        const { o, b, actor } = await management(request, params.id, params.branch);
        const url = new URL(request.url);
        const scope = sha(url.pathname + b.id + actor.id);
        const cursor = url.searchParams.get('cursor');
        let before;
        if (cursor) {
          const decoded = managementCursor.decode(cursor);
          if (decoded.scope !== scope)
            throw new QBError('INVALID_CURSOR', 'Job cursor belongs to another branch');
          before = { createdAt: decoded.createdAt, id: decoded.id };
        }
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const rows = await o.call('jobs-list', { limit, before });
        const last = rows.at(-1);
        return success(rows, request, {
          cursor:
            rows.length === limit && last
              ? managementCursor.encode({
                  scope,
                  createdAt: last.createdAt,
                  id: last.id,
                })
              : undefined,
        });
      })
      .get(
        '/management/v1/projects/:id/branches/:branch/jobs/:job',
        async ({ request, params }) => {
          const { o } = await management(request, params.id, params.branch);
          return success(await o.call('jobs-get', { id: params.job }), request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/jobs/:job/cancel',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const job = await o.call('jobs-cancel', { id: params.job });
          await audit(actor.id, 'job.cancel', job.id, p, request);
          return success(job, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/jobs/:job/replay',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const idempotencyKey = request.headers.get('idempotency-key');
          if (!idempotencyKey)
            throw new QBError('VALIDATION', 'Replay requires an Idempotency-Key');
          const original = await o.call('jobs-get', { id: params.job });
          if (original.kind.startsWith('push.'))
            throw new QBError(
              'JOB_STATE',
              'Push jobs require recipient revalidation through the campaign retry workflow',
              409,
            );
          const job = await o.call('jobs-replay', { id: params.job, idempotencyKey });
          await audit(actor.id, 'job.replay', job.id, p, request);
          return success(job, request);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/policies',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('policy', { policy: body });
          await audit(actor.id, 'policy.update', (body as any).resource, p, request);
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
          // Only explicitly supported fields cross the boundary: never privileged/service bypass flags.
          const roles = Array.isArray(input.identity.roles)
            ? input.identity.roles.filter((r: unknown) => typeof r === 'string')
            : [];
          const identity = {
            role: input.identity.role,
            sub: input.identity.sub ?? null,
            roles,
          };
          if (input.operation !== undefined || input.fixtures !== undefined) {
            const result = await o.call('policy-simulate', {
              table: input.table,
              operation: input.operation ?? 'select',
              identity,
              fixtures: input.fixtures,
              query: input.query,
              input: input.input,
              key: input.key,
              revision: input.revision,
            });
            return success(result, request);
          }
          const result = await o.call('read', {
            table: input.table,
            identity,
            query: input.query ?? { limit: 10 },
          });
          return success(result.data, request, result.meta);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/exposure/:table',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          await o.call('expose', { ...(body as object), table: params.table });
          await audit(actor.id, 'exposure.update', params.table, p, request);
          return success({ updated: true }, request);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/relationships',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('relationship', { relationship: body });
          await audit(actor.id, 'relationship.register', result.name, p, request);
          return success(result, request);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/rpc',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'developer');
          const result = await o.call('rpc-register', { operation: body });
          await audit(actor.id, 'rpc.register', result.name, p, request);
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
      .post(
        '/management/v1/projects/:id/branches/:branch/users',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const input = body as {
            email?: string;
            password?: string;
            name?: string;
            emailVerified?: boolean;
            roles?: string[];
          };
          const user = await o.call('user-create', input);
          await audit(actor.id, 'user.create', user.id, p, request);
          return success(user, request);
        },
      )
      .patch(
        '/management/v1/projects/:id/branches/:branch/users/:user',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const user = await o.call('user-update', { userId: params.user, ...(body as object) });
          await audit(actor.id, 'user.update', params.user, p, request);
          return success(user, request);
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/users/:user',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const result = await o.call('user-delete', { userId: params.user });
          await audit(actor.id, 'user.delete', params.user, p, request);
          return success(result, request);
        },
      )
      .post(
        '/management/v1/projects/:id/branches/:branch/users/:user/ban',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const user = await o.call('user-ban', {
            userId: params.user,
            reason: (body as { reason?: string })?.reason,
          });
          await audit(actor.id, 'user.ban', params.user, p, request);
          return success(user, request);
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/users/:user/ban',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const user = await o.call('user-unban', { userId: params.user });
          await audit(actor.id, 'user.unban', params.user, p, request);
          return success(user, request);
        },
      )
      .put(
        '/management/v1/projects/:id/branches/:branch/users/:user/roles',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const result = await o.call('user-roles', {
            userId: params.user,
            roles: (body as { roles?: string[] })?.roles ?? [],
          });
          await audit(actor.id, 'user.roles', params.user, p, request);
          return success(result, request);
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/users/:user/sessions',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          await o.call('revoke', { userId: params.user });
          await audit(actor.id, 'session.revoke', params.user, p, request);
          return success({ revoked: true }, request);
        },
      )
      .get('/management/v1/projects/:id/branches/:branch/roles', async ({ request, params }) => {
        const { o } = await management(request, params.id, params.branch, 'developer');
        return success(await o.call('roles'), request);
      })
      .post(
        '/management/v1/projects/:id/branches/:branch/roles',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const role = await o.call('role-create', body as object);
          await audit(actor.id, 'role.create', role.id, p, request);
          return success(role, request);
        },
      )
      .patch(
        '/management/v1/projects/:id/branches/:branch/roles/:role',
        async ({ request, params, body }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const role = await o.call('role-update', { roleId: params.role, ...(body as object) });
          await audit(actor.id, 'role.update', params.role, p, request);
          return success(role, request);
        },
      )
      .delete(
        '/management/v1/projects/:id/branches/:branch/roles/:role',
        async ({ request, params }) => {
          const { o, p, actor } = await management(request, params.id, params.branch, 'admin');
          const result = await o.call('role-delete', { roleId: params.role });
          await audit(actor.id, 'role.delete', params.role, p, request);
          return success(result, request);
        },
      )
      .get('/management/v1/projects/:id/backups', async ({ request, params }) => {
        const { actor } = await projectAccess(request, params.id);
        return await controlList(
          'SELECT id,branch_id,checksum,schema_version,created_at FROM backups WHERE project_id=?',
          [params.id],
          request,
          actor.id,
          'created_at',
          true,
          'id',
        );
      })
      .get('/management/v1/projects/:id/recovery', async ({ request, params }) => {
        await projectAccess(request, params.id);
        return success(await loadRecoverySettings(db, params.id), request);
      })
      .put('/management/v1/projects/:id/recovery', async ({ request, params, body }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        const version = Number(request.headers.get('if-match'));
        if (!Number.isSafeInteger(version))
          throw new QBError('VALIDATION', 'Send the recovery settings version in If-Match');
        const settings = await saveRecoverySettings(db, p.id, body, version);
        await audit(actor.id, 'recovery.update', p.id, p, request);
        return success(settings, request);
      })
      .get('/management/v1/projects/:id/recovery/destinations', async ({ request, params }) => {
        await projectAccess(request, params.id);
        const rows = (await db
          .query(
            'SELECT id,name,endpoint,region,bucket,prefix,state,created_at,updated_at FROM recovery_destinations WHERE project_id=? ORDER BY created_at DESC',
          )
          .all(params.id)) as any[];
        return success(rows.map(destinationSummary), request);
      })
      .post(
        '/management/v1/projects/:id/recovery/destinations',
        async ({ request, params, body }) => {
          const { p, actor } = await projectAccess(request, params.id, 'admin');
          const input = validateDestinationInput(body);
          const count = Number(
            (
              (await db
                .query('SELECT COUNT(*) AS n FROM recovery_destinations WHERE project_id=?')
                .get(p.id)) as any
            ).n,
          );
          if (count >= 8)
            throw new QBError('VALIDATION', 'At most eight recovery destinations are allowed');
          const id = crypto.randomUUID();
          const created = now();
          await db
            .query(
              'INSERT INTO recovery_destinations(id,project_id,name,endpoint,region,bucket,prefix,credentials,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            )
            .run(
              id,
              p.id,
              input.name,
              input.endpoint,
              input.region,
              input.bucket,
              input.prefix ?? '',
              cipher.seal({
                accessKeyId: input.accessKeyId,
                secretAccessKey: input.secretAccessKey,
              }),
              'active',
              created,
              created,
            );
          await audit(actor.id, 'recovery.destination', id, p, request);
          return success(
            destinationSummary({
              id,
              name: input.name,
              endpoint: input.endpoint,
              region: input.region,
              bucket: input.bucket,
              prefix: input.prefix ?? '',
              state: 'active',
              created_at: created,
              updated_at: created,
            }),
            request,
          );
        },
      )
      .post(
        '/management/v1/projects/:id/recovery/destinations/:destination/state',
        async ({ request, params, body }) => {
          const { p, actor } = await projectAccess(request, params.id, 'admin');
          const state = (body as any)?.state;
          if (state !== 'active' && state !== 'disabled')
            throw new QBError('VALIDATION', 'Destination state must be active or disabled');
          const row = (await db
            .query('SELECT * FROM recovery_destinations WHERE id=? AND project_id=?')
            .get(params.destination, p.id)) as any;
          if (!row) throw new QBError('NOT_FOUND', 'Destination not available', 404);
          await db
            .query('UPDATE recovery_destinations SET state=?,updated_at=? WHERE id=?')
            .run(state, now(), row.id);
          await audit(actor.id, 'recovery.destination', row.id, p, request);
          return success(destinationSummary({ ...row, state, updated_at: now() }), request);
        },
      )
      .get('/management/v1/projects/:id/recovery/inventory', async ({ request, params }) => {
        await projectAccess(request, params.id);
        return success(await buildInventory(db, params.id), request);
      })
      .get('/management/v1/projects/:id/recovery/drills', async ({ request, params }) => {
        await projectAccess(request, params.id);
        const rows = (await db
          .query(
            'SELECT * FROM recovery_drills WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 50',
          )
          .all(params.id)) as any[];
        return success(rows.map(drillSummary), request);
      })
      .post('/management/v1/projects/:id/recovery/drills', async ({ request, params, body }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        const backupId = (body as any)?.backupId;
        if (typeof backupId !== 'string')
          throw new QBError('VALIDATION', 'Provide backupId for the drill');
        const backup = (await db
          .query('SELECT * FROM backups WHERE id=? AND project_id=?')
          .get(backupId, p.id)) as any;
        if (!backup) throw new QBError('NOT_FOUND', 'Backup not available', 404);
        const b = await branch(p.id, backup.branch_id);
        const o = owner(p, b, false);
        try {
          return success(await enqueueRecoveryDrill(p, b, backupId, o, actor.id, request), request);
        } finally {
          /* Keep the owner warm for subsequent maintenance; do not close here. */
        }
      })
      .post(
        '/management/v1/projects/:id/recovery/drills/:drill/cancel',
        async ({ request, params }) => {
          const { p, actor } = await projectAccess(request, params.id, 'admin');
          const drill = (await db
            .query('SELECT * FROM recovery_drills WHERE id=? AND project_id=?')
            .get(params.drill, p.id)) as any;
          if (!drill) throw new QBError('NOT_FOUND', 'Drill not available', 404);
          if (!['queued', 'restoring', 'validating'].includes(drill.state))
            throw new QBError('CONFLICT', 'Drill is no longer cancellable', 409);
          await db
            .query(
              "UPDATE recovery_drills SET state='cancelled',updated_at=?,finished_at=? WHERE id=?",
            )
            .run(now(), now(), drill.id);
          if (drill.job_id && drill.branch_id) {
            try {
              const b = await branch(p.id, drill.branch_id);
              await owner(p, b, false).call('jobs-cancel', { id: drill.job_id });
            } catch {
              /* Job may already be finished or cancelled. */
            }
          }
          await audit(actor.id, 'recovery.drill', drill.id, p, request);
          return success(
            drillSummary({
              ...drill,
              state: 'cancelled',
              updated_at: now(),
              finished_at: now(),
            }),
            request,
          );
        },
      )
      .post('/management/v1/projects/:id/branches/:branch/backups', async ({ request, params }) => {
        const { p, b, actor } = await management(request, params.id, params.branch, 'admin');
        return success(await backup(p, b, actor.id, request), request);
      })
      .post('/management/v1/projects/:id/backups/:backup/restore', async ({ request, params }) => {
        const { p, actor } = await projectAccess(request, params.id, 'admin');
        if (activeBackups >= 2)
          throw new QBError(
            'BACKUP_BUSY',
            'Backup/restore capacity reached; retry later',
            503,
            true,
          );
        activeBackups++;
        try {
          const record = (await db
            .query('SELECT * FROM backups WHERE id=? AND project_id=?')
            .get(params.backup, p.id)) as any;
          if (!record) throw new QBError('NOT_FOUND', 'Backup not available', 404);
          const id = crypto.randomUUID();
          const path = branchPath(config.dataDir, p.id, id);
          mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
          try {
            await decryptArchive(
              record.path,
              path + '.snapshot',
              Buffer.from(realmSecret(config.master, 'backups'), 'hex'),
              record.checksum,
              {
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
                // Recovery must remain possible when operators lower a branch's write quota.
                maxBytes: Math.max(1073741824, cipher.open(p.config).quotas?.databaseBytes ?? 0),
              },
            );
          } catch (error) {
            rmSync(join(path, '..'), { recursive: true, force: true });
            throw error;
          }
          let restored: ReturnType<typeof openDatabase> | undefined;
          try {
            await restoreDatabase(path + '.snapshot', path);
            rmSync(path + '.snapshot', { force: true });
            restored = openDatabase(path);
            await restored.exec('SET CONSTRAINTS ALL IMMEDIATE');
            if (
              Number(
                (
                  (await restored
                    .query("SELECT value FROM _qb_meta WHERE key='schema_version'")
                    .get()) as any
                ).value,
              ) !== Number(record.schema_version)
            )
              throw new QBError(
                'RESTORE_INVALID',
                'Snapshot schema version differs from its manifest',
                409,
              );
            await restored.exec(
              "DELETE FROM _qb_auth_sessions; DELETE FROM _qb_auth_verifications; UPDATE _qb_objects SET state='unavailable';",
            );
            await restored.exec(
              'UPDATE _qb_auth_accounts SET "accessToken"=NULL,"refreshToken"=NULL,"idToken"=NULL;',
            );
            if (
              await restored
                .query(
                  "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='_qb_jobs'",
                )
                .get()
            )
              await restored.exec('DELETE FROM _qb_jobs;');
            if (
              await restored
                .query(
                  "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='_qb_webhooks'",
                )
                .get()
            )
              await restored.exec('DELETE FROM _qb_webhooks;');
            if (
              await restored
                .query(
                  "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='_qb_security_acknowledgments'",
                )
                .get()
            )
              await restored.exec('DELETE FROM _qb_security_acknowledgments;');
          } catch (error) {
            try {
              await restored?.close(true);
            } catch {}
            rmSync(join(path, '..'), { recursive: true, force: true });
            throw error;
          } finally {
            try {
              await restored?.close(true);
            } catch {}
          }
          await db
            .query(
              'INSERT INTO branches(id,project_id,name,status,generation,created_at,kind) VALUES(?,?,?,?,?,?,?)',
            )
            .run(id, p.id, 'restore-' + id.slice(0, 8), 'ready', 1, now(), 'restore');
          await audit(actor.id, 'backup.restore', id, p, request);
          return success({ branchId: id, status: 'ready', sessionsExcluded: true }, request);
        } finally {
          activeBackups--;
        }
      })
      .post(
        '/management/v1/projects/:id/branches/:branch/cutover',
        async ({ request, params, body }) => {
          const { p, b, actor } = await management(request, params.id, params.branch, 'owner');
          if ((body as any).confirm !== p.slug)
            throw new QBError('VALIDATION', 'Confirm the project slug');
          const old = await branch(p.id, 'primary');
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
            await db.transaction(async (tx) => {
              await tx
                .query(
                  "UPDATE branches SET name=?,status='retired',generation=generation+1 WHERE id=?",
                )
                .run('previous-' + old.id.slice(0, 8), old.id);
              await tx
                .query("UPDATE branches SET name='main',generation=generation+1 WHERE id=?")
                .run(b.id);
            })();
            await audit(actor.id, 'branch.cutover', b.id, p, request);
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
        return await controlList(
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
          await audit(actor.id, 'bucket.create', r.id, p, request);
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
            identity: { sub: actor.id, role: 'authenticated', roles: [] },
            idempotency: request.headers.get('idempotency-key'),
            maxStorageBytes: cipher.open(p.config).quotas?.storageBytes ?? 1073741824,
          });
          await audit(actor.id, 'storage.intent', result.id, p, request);
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
          let staged: Awaited<ReturnType<typeof stageTransfer>> | undefined;
          try {
            const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120000)]);
            staged = await stageTransfer(
              request.body,
              transferDirectory,
              Number(obj.size),
              obj.expected_sha,
              signal,
            );
            const contentSha = staged.checksum;
            if (obj.state === 'ready') {
              if (obj.content_sha !== contentSha)
                throw new QBError(
                  'IDEMPOTENCY_CONFLICT',
                  'Finalized object has different bytes',
                  409,
                );
              return success({ id: obj.id, state: 'ready' }, request);
            }
            const result = await backend.putFile(
              `${p.id}/${b.id}/${obj.id}`,
              staged.path,
              staged.size,
              obj.mime,
              signal,
            );
            await o.call('object-state', {
              id: obj.id,
              state: 'ready',
              etag: result.etag,
              contentSha,
            });
            await audit(actor.id, 'storage.upload', obj.id, p, request);
            return success({ id: obj.id, state: 'ready' }, request);
          } catch (error) {
            if (obj.state !== 'ready')
              await o.call('object-state', { id: obj.id, state: 'failed' });
            throw error;
          } finally {
            await staged?.dispose();
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
          await audit(actor.id, 'storage.delete', obj.id, p, request);
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
        let access: {
          o: BranchOwner;
          b: any;
        };
        if (callback) {
          if (fenced.has(params.id))
            throw new QBError('OWNER_UNAVAILABLE', 'Branch cutover is in progress', 503, true);
          const p = (await db
            .query("SELECT * FROM projects WHERE id=? AND status='ready'")
            .get(params.id)) as any;
          if (!p) throw new QBError('NOT_FOUND', 'Project not available', 404);
          const b = await branch(p.id, params.branch);
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
          revision: request.headers.has('if-match')
            ? Number(request.headers.get('if-match'))
            : undefined,
        });
        return success(r.data, request, r.meta);
      })
      .post('/v1/projects/:id/branches/:branch/search', async ({ request, params, body }) => {
        const { o, identity } = await application(request, params.id, params.branch);
        return success(await o.call('search', { ...(body as object), identity }), request);
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
      .post(
        '/v1/projects/:id/branches/:branch/storage/buckets/:bucket/resumable',
        async ({ request, params, body }) => {
          const { o, identity, p } = await application(request, params.id, params.branch);
          backend.check();
          const input = body as { key?: string; size?: number; mime?: string; checksum?: string };
          const intent = await o.call('upload-intent', {
            key: input.key,
            size: input.size,
            mime: input.mime,
            checksum: input.checksum,
            bucket: params.bucket,
            identity,
            idempotency: request.headers.get('idempotency-key'),
            maxStorageBytes: cipher.open(p.config).quotas?.storageBytes ?? 1073741824,
          });
          const session = await resumableUploads.createSession({
            objectId: intent.id,
            bucketId: params.bucket,
            key: String(input.key),
            length: Number(input.size),
            ownerId: identity.sub ?? 'anonymous',
          });
          return success(session, request);
        },
      )
      .head(
        '/v1/projects/:id/branches/:branch/storage/resumable/:upload',
        async ({ request, params, set }) => {
          await application(request, params.id, params.branch);
          const session = resumableUploads.session(params.upload);
          set.headers['upload-offset'] = String(session.offset);
          set.headers['upload-length'] = String(session.length);
          set.status = 204;
          return '';
        },
      )
      .patch(
        '/v1/projects/:id/branches/:branch/storage/resumable/:upload',
        async ({ request, params }) => {
          const { o, identity, p, b } = await application(request, params.id, params.branch);
          const expected = Number(request.headers.get('upload-offset') ?? '0');
          const chunk = new Uint8Array(await request.arrayBuffer());
          const offset = await resumableUploads.append(params.upload, chunk, expected);
          const session = resumableUploads.session(params.upload);
          if (offset === session.length) {
            const path = await resumableUploads.finalize(params.upload);
            try {
              await o.call('upload-claim', { id: session.objectId });
              const meta = await o.call('object', { id: session.objectId, identity });
              const hash = createHash('sha256');
              hash.update(Buffer.from(await Bun.file(path).arrayBuffer()));
              const contentSha = hash.digest('hex');
              const result = await backend.putFile(
                `${p.id}/${b.id}/${meta.id}`,
                path,
                session.length,
                meta.mime,
                AbortSignal.timeout(120000),
              );
              await o.call('object-state', {
                id: meta.id,
                state: 'ready',
                etag: result.etag,
                contentSha,
              });
            } finally {
              try {
                resumableUploads.abort(params.upload);
              } catch {
                /* session already removed after finalize path retained */
              }
            }
          }
          return success({ id: params.upload, offset, length: session.length, objectId: session.objectId }, request);
        },
        { parse: 'none' },
      )
      .delete(
        '/v1/projects/:id/branches/:branch/storage/resumable/:upload',
        async ({ request, params }) => {
          await application(request, params.id, params.branch);
          resumableUploads.abort(params.upload);
          return success({ aborted: true }, request);
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
          let staged: Awaited<ReturnType<typeof stageTransfer>> | undefined;
          try {
            const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120000)]);
            staged = await stageTransfer(
              request.body,
              transferDirectory,
              Number(obj.size),
              obj.expected_sha,
              signal,
            );
            const contentSha = staged.checksum;
            if (obj.state === 'ready') {
              if (obj.content_sha !== contentSha)
                throw new QBError(
                  'IDEMPOTENCY_CONFLICT',
                  'Finalized object has different bytes',
                  409,
                );
              return success({ id: obj.id, state: 'ready' }, request);
            }
            const result = await backend.putFile(
              `${p.id}/${b.id}/${obj.id}`,
              staged.path,
              staged.size,
              obj.mime,
              signal,
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
          } finally {
            await staged?.dispose();
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
      .get(
        '/v1/projects/:id/branches/:branch/storage/objects/:object/transform',
        async ({ request, params }) => {
          const { o, identity, p, b } = await application(request, params.id, params.branch);
          const obj = await o.call('object', { id: params.object, identity, read: true });
          if (obj.state !== 'ready') throw new QBError('NOT_FOUND', 'Object not ready', 404);
          const url = new URL(request.url);
          const options = {
            width: url.searchParams.get('width')
              ? Number(url.searchParams.get('width'))
              : undefined,
            height: url.searchParams.get('height')
              ? Number(url.searchParams.get('height'))
              : undefined,
            fit: (url.searchParams.get('fit') as any) || undefined,
            quality: url.searchParams.get('quality')
              ? Number(url.searchParams.get('quality'))
              : undefined,
            format: (url.searchParams.get('format') as any) || undefined,
          };
          const result = await backend.get(`${p.id}/${b.id}/${obj.id}`);
          const bytes = new Uint8Array(await new Response(result.body).arrayBuffer());
          const transformed = await transformImage(bytes, options);
          return new Response(Buffer.from(transformed.bytes), {
            headers: {
              'content-type': transformed.mime,
              'cache-control': 'private, max-age=60',
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
        closing = true;
        for (const t of timers) clearInterval(t);
        await maintenanceTask?.catch(() => {});
        await Promise.allSettled([...owners.values()].map((o) => o.close()));
        await db.close(true);
        release();
      },
      timers,
    };
  } catch (error) {
    release();
    throw error;
  }
}
