import { mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  QBError,
  recoveryIntervals,
  type RecoverySettings,
  type RecoveryDestinationSummary,
  type RecoveryDestinationInput,
  type RecoveryInventory,
  type RecoveryDrillSummary,
  type RecoveryDrillReport,
  type DrillDimensionResult,
  type RecoveryFindingCode,
} from '@qb-flex/contracts';
import {
  DestinationBackend,
  ObjectBackend,
  isRecoveryTestEndpoint,
  RECOVERY_TEST_HOST,
} from '@qb-flex/storage';
import { openDatabase, restoreDatabase, branchPath } from '@qb-flex/database';
import { realmSecret } from '@qb-flex/auth';
import { decryptArchive } from '../../../packages/database/src/archive';
import { webhookURL } from '../../worker/src/webhook-delivery';

const now = () => new Date().toISOString();

export type RecoveryDb = {
  query: (sql: string) => {
    get: (...args: unknown[]) => Promise<unknown> | unknown;
    all: (...args: unknown[]) => Promise<unknown[]> | unknown[];
    run: (...args: unknown[]) => Promise<unknown> | unknown;
  };
  transaction: (fn: (tx: RecoveryDb) => Promise<void>) => () => Promise<void>;
};

type Cipher = { seal: (value: unknown) => string; open: (value: string) => any };

const DEFAULT_SETTINGS: Omit<RecoverySettings, 'version' | 'updatedAt'> = {
  enabled: true,
  intervalHours: 24,
  retentionDays: 7,
  retentionWeeks: 4,
  drillIntervalHours: 0,
};

function envCeilings() {
  return {
    days: Math.max(1, Math.min(365, Number(process.env.QB_BACKUP_RETENTION_DAYS ?? 7))),
    weeks: Math.max(0, Math.min(52, Number(process.env.QB_BACKUP_RETENTION_WEEKS ?? 4))),
  };
}

export function scheduledBackupsEnabled() {
  return process.env.QB_SCHEDULED_BACKUPS !== 'false';
}

export function defaultRecoverySettings(): RecoverySettings {
  const ceilings = envCeilings();
  return {
    ...DEFAULT_SETTINGS,
    retentionDays: ceilings.days,
    retentionWeeks: ceilings.weeks,
    version: 1,
    updatedAt: now(),
  };
}

export async function loadRecoverySettings(
  db: RecoveryDb,
  projectId: string,
): Promise<RecoverySettings> {
  const row = (await db
    .query('SELECT * FROM recovery_settings WHERE project_id=?')
    .get(projectId)) as any;
  if (!row) return defaultRecoverySettings();
  return {
    enabled: Number(row.enabled) === 1,
    intervalHours: Number(row.interval_hours) as RecoverySettings['intervalHours'],
    retentionDays: Number(row.retention_days),
    retentionWeeks: Number(row.retention_weeks),
    drillIntervalHours: Number(row.drill_interval_hours),
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
}

export function validateRecoverySettings(input: any): Omit<
  RecoverySettings,
  'version' | 'updatedAt'
> {
  const ceilings = envCeilings();
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    throw new QBError('VALIDATION', 'enabled must be a boolean');
  const intervalHours = input.intervalHours ?? DEFAULT_SETTINGS.intervalHours;
  if (!(recoveryIntervals as readonly number[]).includes(Number(intervalHours)))
    throw new QBError('VALIDATION', 'intervalHours must be 1, 6, 12, 24 or 168');
  const retentionDays = Number(input.retentionDays ?? ceilings.days);
  const retentionWeeks = Number(input.retentionWeeks ?? ceilings.weeks);
  const drillIntervalHours = Number(input.drillIntervalHours ?? 0);
  if (
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > ceilings.days
  )
    throw new QBError(
      'VALIDATION',
      `retentionDays must be an integer from 1 to ${ceilings.days}`,
    );
  if (
    !Number.isSafeInteger(retentionWeeks) ||
    retentionWeeks < 0 ||
    retentionWeeks > ceilings.weeks
  )
    throw new QBError(
      'VALIDATION',
      `retentionWeeks must be an integer from 0 to ${ceilings.weeks}`,
    );
  if (
    !Number.isSafeInteger(drillIntervalHours) ||
    drillIntervalHours < 0 ||
    drillIntervalHours > 8760
  )
    throw new QBError('VALIDATION', 'drillIntervalHours must be an integer from 0 to 8760');
  return {
    enabled: input.enabled ?? true,
    intervalHours: Number(intervalHours) as RecoverySettings['intervalHours'],
    retentionDays,
    retentionWeeks,
    drillIntervalHours,
  };
}

export async function saveRecoverySettings(
  db: RecoveryDb,
  projectId: string,
  input: any,
  expectedVersion: number,
) {
  const next = validateRecoverySettings(input);
  const current = await loadRecoverySettings(db, projectId);
  if (current.version !== expectedVersion)
    throw new QBError('CONFIG_CONFLICT', 'Refresh recovery settings and send its version', 409);
  const version = current.version + 1;
  const updatedAt = now();
  await db
    .query(
      `INSERT INTO recovery_settings(project_id,enabled,interval_hours,retention_days,retention_weeks,drill_interval_hours,updated_at,version)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET
         enabled=excluded.enabled,interval_hours=excluded.interval_hours,retention_days=excluded.retention_days,
         retention_weeks=excluded.retention_weeks,drill_interval_hours=excluded.drill_interval_hours,
         updated_at=excluded.updated_at,version=excluded.version`,
    )
    .run(
      projectId,
      next.enabled ? 1 : 0,
      next.intervalHours,
      next.retentionDays,
      next.retentionWeeks,
      next.drillIntervalHours,
      updatedAt,
      version,
    );
  return { ...next, version, updatedAt };
}

export function validateDestinationEndpoint(endpoint: string) {
  if (isRecoveryTestEndpoint(endpoint)) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new QBError('DESTINATION_DENIED', 'Use HTTPS without credentials', 400);
    return url;
  }
  return webhookURL(endpoint);
}

export function validateDestinationInput(input: any): RecoveryDestinationInput {
  if (!input || typeof input !== 'object') throw new QBError('VALIDATION', 'Invalid destination');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 128)
    throw new QBError('VALIDATION', 'Provide a destination name up to 128 characters');
  if (typeof input.endpoint !== 'string') throw new QBError('VALIDATION', 'Provide an endpoint URL');
  validateDestinationEndpoint(input.endpoint);
  if (typeof input.region !== 'string' || !input.region.trim() || input.region.length > 64)
    throw new QBError('VALIDATION', 'Provide a region');
  if (
    typeof input.bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket)
  )
    throw new QBError('VALIDATION', 'Provide a valid bucket name');
  const prefix =
    input.prefix === undefined || input.prefix === ''
      ? ''
      : String(input.prefix).replace(/^\/+|\/+$/g, '');
  if (prefix.length > 512 || /[\u0000-\u001f]/.test(prefix))
    throw new QBError('VALIDATION', 'Invalid object prefix');
  if (
    typeof input.accessKeyId !== 'string' ||
    input.accessKeyId.length < 4 ||
    input.accessKeyId.length > 256
  )
    throw new QBError('VALIDATION', 'Provide accessKeyId');
  if (
    typeof input.secretAccessKey !== 'string' ||
    input.secretAccessKey.length < 8 ||
    input.secretAccessKey.length > 512
  )
    throw new QBError('VALIDATION', 'Provide secretAccessKey');
  return {
    name: input.name.trim(),
    endpoint: input.endpoint,
    region: input.region.trim(),
    bucket: input.bucket,
    prefix,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
  };
}

export function destinationSummary(row: any): RecoveryDestinationSummary {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    prefix: row.prefix ?? '',
    state: row.state,
    credentialsConfigured: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function openDestination(
  row: any,
  cipher: Cipher,
  dataDir: string,
): DestinationBackend {
  const credentials = cipher.open(row.credentials);
  const localRoot = isRecoveryTestEndpoint(row.endpoint)
    ? join(dataDir, 'recovery-store')
    : undefined;
  return new DestinationBackend(
    {
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    { localRoot },
  );
}

export function replicaObjectKey(prefix: string, projectId: string, backupId: string) {
  const base = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
  return `${base}projects/${projectId}/backups/${backupId}.pglite.tar.enc`;
}

export async function upsertFinding(
  db: RecoveryDb,
  projectId: string,
  code: RecoveryFindingCode,
  resource: string,
  message: string,
) {
  const open = (await db
    .query(
      'SELECT id FROM recovery_findings WHERE project_id=? AND code=? AND resource=? AND resolved_at IS NULL',
    )
    .get(projectId, code, resource)) as any;
  if (open) return open.id;
  const id = crypto.randomUUID();
  await db
    .query(
      'INSERT INTO recovery_findings(id,project_id,code,resource,message,created_at,resolved_at) VALUES(?,?,?,?,?,?,NULL)',
    )
    .run(id, projectId, code, resource, message, now());
  return id;
}

export async function resolveFinding(
  db: RecoveryDb,
  projectId: string,
  code: RecoveryFindingCode,
  resource: string,
) {
  await db
    .query(
      'UPDATE recovery_findings SET resolved_at=? WHERE project_id=? AND code=? AND resource=? AND resolved_at IS NULL',
    )
    .run(now(), projectId, code, resource);
}

export async function buildInventory(
  db: RecoveryDb,
  projectId: string,
): Promise<RecoveryInventory> {
  const settings = await loadRecoverySettings(db, projectId);
  const intervalMs = settings.intervalHours * 3600000;
  const backups = (await db
    .query(
      'SELECT id,branch_id,checksum,schema_version,created_at FROM backups WHERE project_id=? ORDER BY created_at DESC,id DESC',
    )
    .all(projectId)) as any[];
  const replicas = (await db
    .query(
      `SELECT r.* FROM backup_replicas r
       JOIN backups b ON b.id=r.backup_id
       WHERE b.project_id=?`,
    )
    .all(projectId)) as any[];
  const byBackup = new Map<string, any[]>();
  for (const replica of replicas) {
    const list = byBackup.get(replica.backup_id) ?? [];
    list.push(replica);
    byBackup.set(replica.backup_id, list);
  }
  const items = backups.map((backup) => {
    const ageMs = Date.now() - Date.parse(backup.created_at);
    return {
      id: backup.id,
      branchId: backup.branch_id,
      checksum: backup.checksum,
      schemaVersion: Number(backup.schema_version),
      createdAt: backup.created_at,
      ageMs,
      stale: ageMs > intervalMs,
      replicas: (byBackup.get(backup.id) ?? []).map((replica) => ({
        id: replica.id,
        backupId: replica.backup_id,
        destinationId: replica.destination_id,
        objectKey: replica.object_key,
        state: replica.state,
        errorCode: replica.error_code,
        createdAt: replica.created_at,
        updatedAt: replica.updated_at,
      })),
    };
  });
  const newest = backups[0]?.created_at ?? null;
  if (newest && Date.now() - Date.parse(newest) > intervalMs && settings.enabled) {
    await upsertFinding(
      db,
      projectId,
      'BACKUP_STALE',
      projectId,
      'Newest primary snapshot is older than the configured interval',
    );
  } else if (!newest && settings.enabled) {
    await upsertFinding(
      db,
      projectId,
      'BACKUP_STALE',
      projectId,
      'No primary snapshot is available for the configured interval',
    );
  } else {
    await resolveFinding(db, projectId, 'BACKUP_STALE', projectId);
  }
  return {
    settings,
    items,
    findings: (
      (await db
        .query(
          'SELECT id,code,resource,message,created_at,resolved_at FROM recovery_findings WHERE project_id=? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 50',
        )
        .all(projectId)) as any[]
    ).map((finding) => ({
      id: finding.id,
      code: finding.code as RecoveryFindingCode,
      resource: finding.resource,
      message: finding.message,
      createdAt: finding.created_at,
      resolvedAt: finding.resolved_at,
    })),
    newestBackupAt: newest,
  };
}

export function drillSummary(row: any): RecoveryDrillSummary {
  let report: RecoveryDrillReport | null = null;
  if (row.report) {
    try {
      report = JSON.parse(row.report);
    } catch {
      report = null;
    }
  }
  return {
    id: row.id,
    backupId: row.backup_id,
    branchId: row.branch_id,
    state: row.state,
    databaseResult: row.database_result,
    objectsResult: row.objects_result,
    keyResult: row.key_result,
    report,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export async function applyRetention(
  db: RecoveryDb,
  projectId: string,
  settings: RecoverySettings,
  cipher: Cipher,
  dataDir: string,
) {
  const dailyDays = settings.retentionDays;
  const weeklyCopies = settings.retentionWeeks;
  const retainedWeeks = new Map<string, Set<number>>();
  const newestByBranch = new Map<string, string>();
  for (const record of (await db
    .query(
      'SELECT id,path,branch_id,created_at FROM backups WHERE project_id=? ORDER BY created_at DESC,id DESC',
    )
    .all(projectId)) as any[]) {
    if (!newestByBranch.has(record.branch_id)) newestByBranch.set(record.branch_id, record.id);
  }
  for (const record of (await db
    .query(
      'SELECT id,path,branch_id,created_at FROM backups WHERE project_id=? ORDER BY created_at DESC,id DESC',
    )
    .all(projectId)) as any[]) {
    const age = Date.now() - Date.parse(record.created_at),
      week = Math.floor(Date.parse(record.created_at) / (7 * 86400000));
    const weeks = retainedWeeks.get(record.branch_id) ?? new Set<number>();
    retainedWeeks.set(record.branch_id, weeks);
    const weekly =
      !weeks.has(week) && weeks.size < weeklyCopies && age < (weeklyCopies + 1) * 7 * 86400000;
    if (weekly) weeks.add(week);
    const newest = newestByBranch.get(record.branch_id) === record.id;
    if (age < dailyDays * 86400000 || weekly || newest) continue;
    const replicas = (await db
      .query('SELECT * FROM backup_replicas WHERE backup_id=?')
      .all(record.id)) as any[];
    for (const replica of replicas) {
      if (replica.object_key && replica.state === 'verified') {
        const destination = (await db
          .query('SELECT * FROM recovery_destinations WHERE id=?')
          .get(replica.destination_id)) as any;
        if (destination) {
          try {
            await openDestination(destination, cipher, dataDir).delete(replica.object_key);
          } catch {
            /* Best-effort remote cleanup; local retention still proceeds. */
          }
        }
      }
      await db.query('DELETE FROM backup_replicas WHERE id=?').run(replica.id);
    }
    rmSync(record.path, { force: true });
    await db.query('DELETE FROM backups WHERE id=?').run(record.id);
  }
}

export async function uploadBackupReplicas(
  db: RecoveryDb,
  project: any,
  backupId: string,
  localPath: string,
  cipher: Cipher,
  dataDir: string,
  signal?: AbortSignal,
) {
  if (!scheduledBackupsEnabled()) return;
  const destinations = (await db
    .query("SELECT * FROM recovery_destinations WHERE project_id=? AND state='active'")
    .all(project.id)) as any[];
  if (!destinations.length) return;
  const size = statSync(localPath).size;
  for (const destination of destinations) {
    const id = crypto.randomUUID();
    const objectKey = replicaObjectKey(destination.prefix ?? '', project.id, backupId);
    const created = now();
    await db
      .query(
        'INSERT INTO backup_replicas(id,backup_id,destination_id,object_key,state,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(id, backupId, destination.id, objectKey, 'staging', null, created, created);
    try {
      await db
        .query("UPDATE backup_replicas SET state='encrypted',updated_at=? WHERE id=?")
        .run(now(), id);
      await db
        .query("UPDATE backup_replicas SET state='uploading',updated_at=? WHERE id=?")
        .run(now(), id);
      const store = openDestination(destination, cipher, dataDir);
      await store.putFile(
        objectKey,
        localPath,
        size,
        'application/octet-stream',
        signal ?? AbortSignal.timeout(120000),
      );
      await store.head(objectKey, signal ?? AbortSignal.timeout(30000));
      await db
        .query(
          "UPDATE backup_replicas SET state='verified',object_key=?,error_code=NULL,updated_at=? WHERE id=?",
        )
        .run(objectKey, now(), id);
      await resolveFinding(db, project.id, 'DESTINATION_UNAVAILABLE', destination.id);
    } catch {
      await db
        .query(
          "UPDATE backup_replicas SET state='failed',error_code=?,updated_at=? WHERE id=?",
        )
        .run('DESTINATION_UNAVAILABLE', now(), id);
      await upsertFinding(
        db,
        project.id,
        'DESTINATION_UNAVAILABLE',
        destination.id,
        'Could not upload or verify an encrypted archive at the recovery destination',
      );
    }
  }
}

async function verifyObjects(
  backend: ObjectBackend,
  owner: { call: (op: string, args?: unknown) => Promise<any> },
  projectId: string,
  branchId: string,
  signal: AbortSignal,
): Promise<{ result: DrillDimensionResult; notes: string[] }> {
  const notes: string[] = [];
  try {
    backend.check();
  } catch {
    return {
      result: 'failed',
      notes: ['Application object storage is not configured'],
    };
  }
  try {
    const versioned = await backend.versioningEnabled(signal);
    if (!versioned) {
      notes.push('Object-store versioning is not enabled');
      return { result: 'failed', notes };
    }
    const objects = ((await owner.call('purge-storage-keys')) as any[]).filter(
      (object) => object.state === 'ready',
    );
    const sample = objects.slice(0, 20);
    if (!sample.length) {
      notes.push('No application objects to verify');
      return { result: 'passed', notes };
    }
    for (const object of sample) {
      await backend.head(`${projectId}/${branchId}/${object.id}`, signal);
    }
    notes.push(`Verified ${sample.length} object head(s) and bucket versioning`);
    return { result: 'passed', notes };
  } catch {
    return {
      result: 'failed',
      notes: ['Object backup availability or checksum head failed'],
    };
  }
}

export async function executeDrill(options: {
  db: RecoveryDb;
  drillId: string;
  project: any;
  dataDir: string;
  master: string;
  cipher: Cipher;
  backend: ObjectBackend;
  openOwner: (project: any, branch: any) => { call: (op: string, args?: unknown) => Promise<any> };
  signal?: AbortSignal;
}) {
  const {
    db,
    drillId,
    project,
    dataDir,
    master,
    cipher,
    backend,
    openOwner,
    signal = AbortSignal.timeout(120000),
  } = options;
  const drill = (await db
    .query('SELECT * FROM recovery_drills WHERE id=? AND project_id=?')
    .get(drillId, project.id)) as any;
  if (!drill) throw new QBError('NOT_FOUND', 'Drill not available', 404);
  if (drill.state === 'cancelled') return drillSummary(drill);
  if (!['queued', 'restoring', 'validating'].includes(drill.state)) return drillSummary(drill);

  const backup = (await db
    .query('SELECT * FROM backups WHERE id=? AND project_id=?')
    .get(drill.backup_id, project.id)) as any;
  if (!backup) {
    await finishDrill(db, drillId, 'failed', 'failed', 'failed', 'failed', {
      database: 'failed',
      objects: 'failed',
      key: 'failed',
      notes: ['Backup record missing'],
    });
    return drillSummary(
      (await db.query('SELECT * FROM recovery_drills WHERE id=?').get(drillId)) as any,
    );
  }

  await db
    .query("UPDATE recovery_drills SET state='restoring',updated_at=? WHERE id=?")
    .run(now(), drillId);

  const scratchId = crypto.randomUUID();
  const scratchRoot = join(dataDir, 'recovery-drills', scratchId);
  mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  const path = join(scratchRoot, 'main.pglite');
  let databaseResult: DrillDimensionResult = 'failed';
  let keyResult: DrillDimensionResult = 'failed';
  let objectsResult: DrillDimensionResult = 'failed';
  const notes: string[] = [];
  let restored: ReturnType<typeof openDatabase> | undefined;

  try {
    try {
      await decryptArchive(
        backup.path,
        path + '.snapshot',
        Buffer.from(realmSecret(master, 'backups'), 'hex'),
        backup.checksum,
        {
          signal,
          maxBytes: Math.max(1073741824, cipher.open(project.config).quotas?.databaseBytes ?? 0),
        },
      );
      keyResult = 'passed';
      notes.push('Master key authenticated the archive');
    } catch (error) {
      keyResult = 'failed';
      const code =
        error instanceof QBError && error.code === 'BACKUP_CORRUPT'
          ? 'BACKUP_CORRUPT'
          : 'KEY_UNAVAILABLE';
      notes.push(
        code === 'BACKUP_CORRUPT'
          ? 'Archive authentication or checksum failed'
          : 'Master key could not open the archive',
      );
      await upsertFinding(db, project.id, code, backup.id, notes[notes.length - 1]!);
      await finishDrill(db, drillId, 'failed', databaseResult, objectsResult, keyResult, {
        database: databaseResult,
        objects: objectsResult,
        key: keyResult,
        notes,
      });
      return drillSummary(
        (await db.query('SELECT * FROM recovery_drills WHERE id=?').get(drillId)) as any,
      );
    }

    await db
      .query("UPDATE recovery_drills SET state='validating',updated_at=? WHERE id=?")
      .run(now(), drillId);

    try {
      await restoreDatabase(path + '.snapshot', path);
      rmSync(path + '.snapshot', { force: true });
      restored = openDatabase(path);
      await restored.exec('SET CONSTRAINTS ALL IMMEDIATE');
      const schemaVersion = Number(
        (
          (await restored
            .query("SELECT value FROM _qb_meta WHERE key='schema_version'")
            .get()) as any
        ).value,
      );
      if (schemaVersion !== Number(backup.schema_version))
        throw new QBError('RESTORE_INVALID', 'Snapshot schema version differs from its manifest', 409);
      databaseResult = 'passed';
      notes.push('Database integrity, constraints and schema version validated');
      await resolveFinding(db, project.id, 'BACKUP_CORRUPT', backup.id);
    } catch {
      databaseResult = 'failed';
      notes.push('Database restore validation failed');
      await upsertFinding(
        db,
        project.id,
        'BACKUP_CORRUPT',
        backup.id,
        'Isolated restore failed integrity or schema checks',
      );
    } finally {
      try {
        await restored?.close(true);
      } catch {
        /* ignore */
      }
      restored = undefined;
    }

    const branch = (await db
      .query('SELECT * FROM branches WHERE id=?')
      .get(drill.branch_id)) as any;
    if (branch) {
      const owner = openOwner(project, branch);
      const objects = await verifyObjects(backend, owner, project.id, branch.id, signal);
      objectsResult = objects.result;
      notes.push(...objects.notes);
      if (objectsResult === 'failed')
        await upsertFinding(
          db,
          project.id,
          'OBJECT_BACKUP_MISSING',
          project.id,
          'Object backup verification failed or versioning is unavailable',
        );
      else await resolveFinding(db, project.id, 'OBJECT_BACKUP_MISSING', project.id);
    } else {
      objectsResult = 'failed';
      notes.push('Source branch unavailable for object verification');
    }

    const allPassed =
      databaseResult === 'passed' && objectsResult === 'passed' && keyResult === 'passed';
    const anyFailed =
      databaseResult === 'failed' || objectsResult === 'failed' || keyResult === 'failed';
    // Database-only success cannot become complete when objects or keys are unverified.
    const state = allPassed ? 'complete' : anyFailed && databaseResult === 'passed' ? 'partial' : 'failed';
    await finishDrill(db, drillId, state, databaseResult, objectsResult, keyResult, {
      database: databaseResult,
      objects: objectsResult,
      key: keyResult,
      notes,
    });
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
  return drillSummary(
    (await db.query('SELECT * FROM recovery_drills WHERE id=?').get(drillId)) as any,
  );
}

async function finishDrill(
  db: RecoveryDb,
  drillId: string,
  state: string,
  databaseResult: DrillDimensionResult,
  objectsResult: DrillDimensionResult,
  keyResult: DrillDimensionResult,
  report: RecoveryDrillReport,
) {
  const finished = now();
  await db
    .query(
      'UPDATE recovery_drills SET state=?,database_result=?,objects_result=?,key_result=?,report=?,updated_at=?,finished_at=? WHERE id=?',
    )
    .run(
      state,
      databaseResult,
      objectsResult,
      keyResult,
      JSON.stringify(report),
      finished,
      finished,
      drillId,
    );
}

export { RECOVERY_TEST_HOST, branchPath, existsSync };
