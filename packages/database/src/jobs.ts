import type { Database } from './connection';
import { createHash } from 'node:crypto';
import { QBError } from '@qb-flex/contracts';
import { jobKinds, type JobKind, type JobSummary, type JobAttempt } from '../../contracts/src/jobs';
interface Codec {
  seal(value: unknown): string;
  open(value: string): any;
}
interface Submission {
  kind: JobKind;
  deduplicationKey: string;
  eventId: string;
  payload: unknown;
  availableAt?: number;
  parentId?: string;
}
const policies: Record<
  JobKind,
  {
    attempts: number;
    window: number;
  }
> = {
  'recovery.drill': { attempts: 3, window: 86400000 },
  'webhook.delivery': { attempts: 10, window: 86400000 },
  'alert.email': { attempts: 10, window: 86400000 },
  'push.dispatch': { attempts: 6, window: 3600000 },
  'push.receipts': { attempts: 6, window: 3600000 },
  maintenance: { attempts: 3, window: 86400000 },
};
const terminal = ['succeeded', 'dead', 'cancelled'];
const selectSummary = `id,event_id AS "eventId",kind,state,attempts,max_attempts AS "maxAttempts",
 available_at AS "availableAt",deadline_at AS "deadlineAt",lease_until AS "leaseUntil",
 created_at AS "createdAt",updated_at AS "updatedAt",parent_id AS "parentId",last_code AS "lastCode"`;
function summary(row: any): JobSummary {
  return {
    ...row,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.maxAttempts),
    availableAt: Number(row.availableAt),
    deadlineAt: Number(row.deadlineAt),
    leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}
function invalid(message: string): never {
  throw new QBError('VALIDATION', message);
}
function text(value: unknown, maximum = 200): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > maximum)
    invalid('Invalid job identifier');
}
/** All calls run inside the existing branch owner. Never opens another database instance. */
export class DurableJobs {
  constructor(
    private db: Database,
    private codec: Codec,
    private clock = Date.now,
  ) {}
  async initialize() {
    await this.db.exec(`CREATE TABLE IF NOT EXISTS _qb_jobs(
      id TEXT PRIMARY KEY,event_id TEXT NOT NULL,kind TEXT NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE,digest TEXT NOT NULL,payload TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN('queued','leased','retry_wait','succeeded','dead','cancelled')),
      attempts BIGINT NOT NULL DEFAULT 0,max_attempts BIGINT NOT NULL,
      available_at BIGINT NOT NULL,deadline_at BIGINT NOT NULL,
      lease_until BIGINT,lease_token TEXT,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,
      parent_id TEXT,last_code TEXT);
      CREATE INDEX IF NOT EXISTS _qb_jobs_claim ON _qb_jobs(kind,state,available_at,created_at);
      CREATE TABLE IF NOT EXISTS _qb_job_attempts(
        job_id TEXT NOT NULL REFERENCES _qb_jobs(id) ON DELETE CASCADE,attempt BIGINT NOT NULL,
        started_at BIGINT NOT NULL,finished_at BIGINT,outcome TEXT NOT NULL,code TEXT,
        PRIMARY KEY(job_id,attempt));`);
    return this;
  }
  async submit(input: Submission): Promise<JobSummary> {
    if (!input || !jobKinds.includes(input.kind)) invalid('Unsupported job kind');
    text(input.deduplicationKey);
    text(input.eventId);
    if (input.parentId !== undefined) text(input.parentId);
    const json = JSON.stringify(input.payload);
    if (json === undefined || Buffer.byteLength(json) > 65536)
      invalid('Job payload must be JSON up to 64 KiB');
    const now = this.clock(),
      available = input.availableAt ?? now;
    if (!Number.isSafeInteger(available) || available < 0 || available > now + 7 * 86400000)
      invalid('Job schedule must be within seven days');
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          kind: input.kind,
          eventId: input.eventId,
          payload: JSON.parse(json),
          // Omitted schedule is stable across retries, not the changing current clock.
          availableAt: input.availableAt ?? null,
          parentId: input.parentId ?? null,
        }),
      )
      .digest('hex');
    return await this.db
      .transaction(async (tx) => {
        const old = (await tx
          .query('SELECT id,digest FROM _qb_jobs WHERE dedup_key=?')
          .get(input.deduplicationKey)) as any;
        if (old) {
          if (old.digest !== digest)
            throw new QBError('IDEMPOTENCY_CONFLICT', 'Job key reused with different content', 409);
          return await this.get(old.id);
        }
        if (
          Number(
            (
              (await tx
                .query(
                  "SELECT count(*) AS n FROM _qb_jobs WHERE state NOT IN('succeeded','dead','cancelled')",
                )
                .get()) as any
            ).n,
          ) >= 10000
        )
          throw new QBError('QUEUE_FULL', 'Durable job queue is full', 503, true);
        const id = crypto.randomUUID(),
          policy = policies[input.kind];
        await tx
          .query(
            `INSERT INTO _qb_jobs(id,event_id,kind,dedup_key,digest,payload,state,max_attempts,
        available_at,deadline_at,created_at,updated_at,parent_id) VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?,?)`,
          )
          .run(
            id,
            input.eventId,
            input.kind,
            input.deduplicationKey,
            digest,
            this.codec.seal(JSON.parse(json)),
            policy.attempts,
            available,
            available + policy.window,
            now,
            now,
            input.parentId ?? null,
          );
        return await this.get(id);
      })
      .immediate();
  }
  async get(id: string): Promise<JobSummary> {
    text(id);
    const row = await this.db.query(`SELECT ${selectSummary} FROM _qb_jobs WHERE id=?`).get(id);
    if (!row) throw new QBError('NOT_FOUND', 'Job not available', 404);
    return summary(row);
  }
  async list(
    options: {
      limit?: number;
      before?: {
        createdAt: number;
        id: string;
      };
      state?: JobSummary['state'];
    } = {},
  ): Promise<JobSummary[]> {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) invalid('Job limit must be 1–500');
    if (options.state && !['queued', 'leased', 'retry_wait', ...terminal].includes(options.state))
      invalid('Invalid job state');
    if (
      options.before &&
      (!Number.isSafeInteger(options.before.createdAt) || typeof options.before.id !== 'string')
    )
      invalid('Invalid job cursor');
    return (
      await this.db
        .query(
          `SELECT ${selectSummary} FROM _qb_jobs
      WHERE (?::text IS NULL OR state=?) AND (?::bigint IS NULL OR (created_at,id)<(?,?))
      ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(
          options.state ?? null,
          options.state ?? null,
          options.before?.createdAt ?? null,
          options.before?.createdAt ?? null,
          options.before?.id ?? null,
          limit,
        )
    ).map(summary);
  }
  async attempts(id: string): Promise<JobAttempt[]> {
    await this.get(id);
    return (
      await this.db
        .query(
          `SELECT attempt,started_at AS "startedAt",finished_at AS "finishedAt",outcome,code
      FROM _qb_job_attempts WHERE job_id=? ORDER BY attempt`,
        )
        .all(id)
    ).map((row: any) => ({
      ...row,
      attempt: Number(row.attempt),
      startedAt: Number(row.startedAt),
      finishedAt: row.finishedAt === null ? null : Number(row.finishedAt),
    })) as JobAttempt[];
  }
  /** Revalidate fencing immediately before an executor obtains a dispatch payload. */
  async leased(id: string, leaseToken: string, kinds: readonly JobKind[]): Promise<unknown> {
    text(id);
    text(leaseToken);
    const job = await this.get(id);
    if (!kinds.includes(job.kind)) throw new QBError('DENIED', 'Executor job kind denied', 403);
    const row = (await this.db
      .query('SELECT lease_token,payload FROM _qb_jobs WHERE id=?')
      .get(id)) as any;
    if (job.state !== 'leased' || row.lease_token !== leaseToken || job.leaseUntil! <= this.clock())
      throw new QBError('LEASE_CONFLICT', 'Job lease no longer valid; reconcile side effects', 409);
    try {
      return this.codec.open(row.payload);
    } catch {
      throw new QBError('PAYLOAD_INTEGRITY', 'Job payload failed authentication', 409);
    }
  }
  private async expire(now: number) {
    await this.db
      .query(
        `UPDATE _qb_job_attempts SET finished_at=?,outcome='lease_expired',code='LEASE_EXPIRED'
      WHERE finished_at IS NULL AND job_id IN(SELECT id FROM _qb_jobs WHERE state='leased' AND lease_until<=?)`,
      )
      .run(now, now);
    await this.db
      .query(
        `UPDATE _qb_jobs SET state=CASE WHEN attempts>=max_attempts OR deadline_at<=? THEN 'dead' ELSE 'retry_wait' END,
      lease_token=NULL,lease_until=NULL,updated_at=?,available_at=?,last_code='LEASE_EXPIRED'
      WHERE state='leased' AND lease_until<=?`,
      )
      .run(now, now, now, now);
    await this.db
      .query(
        `UPDATE _qb_jobs SET state='dead',updated_at=?,last_code='DEADLINE_EXCEEDED'
      WHERE state IN('queued','retry_wait') AND deadline_at<=?`,
      )
      .run(now, now);
  }
  async claim(
    kinds: readonly JobKind[],
    leaseMs = 30000,
  ): Promise<
    | (JobSummary & {
        leaseToken: string;
        payload: unknown;
      })
    | null
  > {
    if (!kinds.length || kinds.length > jobKinds.length || kinds.some((k) => !jobKinds.includes(k)))
      invalid('Invalid executor job kinds');
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000)
      invalid('Lease must be 1–60 seconds');
    return await this.db
      .transaction(async (tx) => {
        const now = this.clock();
        await this.expire(now);
        const row = (await tx
          .query(
            `SELECT id,payload,attempts FROM _qb_jobs
        WHERE kind IN(${kinds.map(() => '?').join(',')}) AND state IN('queued','retry_wait')
        AND available_at<=? AND deadline_at>? AND attempts<max_attempts
        ORDER BY available_at,created_at,id LIMIT 1`,
          )
          .get(...kinds, now, now)) as any;
        if (!row) return null;
        // Authenticate ciphertext before committing a claim; corrupted payload must not be dispatched.
        let payload: unknown;
        try {
          payload = this.codec.open(row.payload);
        } catch {
          await tx
            .query(
              "UPDATE _qb_jobs SET state='dead',updated_at=?,last_code='PAYLOAD_INTEGRITY' WHERE id=?",
            )
            .run(now, row.id);
          return null;
        }
        const leaseToken = crypto.randomUUID();
        await tx
          .query(
            `UPDATE _qb_jobs SET state='leased',attempts=attempts+1,lease_until=least(?,deadline_at),
        lease_token=?,updated_at=? WHERE id=?`,
          )
          .run(now + leaseMs, leaseToken, now, row.id);
        await tx
          .query("INSERT INTO _qb_job_attempts VALUES(?,?,?,NULL,'leased',NULL)")
          .run(row.id, Number(row.attempts) + 1, now);
        return { ...(await this.get(row.id)), leaseToken, payload };
      })
      .immediate();
  }
  async finish(
    id: string,
    leaseToken: string,
    result: {
      success: boolean;
      retryable?: boolean;
      code?: string;
    },
    kinds: readonly JobKind[],
  ): Promise<JobSummary> {
    text(id);
    text(leaseToken);
    if (
      !result ||
      typeof result.success !== 'boolean' ||
      (result.retryable !== undefined && typeof result.retryable !== 'boolean')
    )
      invalid('Invalid job outcome');
    // Store controlled diagnostic codes only, never external exception strings or response bodies.
    if (result.code !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(result.code))
      invalid('Invalid diagnostic code');
    return await this.db
      .transaction(async (tx) => {
        const now = this.clock(),
          job = await this.get(id);
        const lease = (await tx
          .query('SELECT lease_token FROM _qb_jobs WHERE id=?')
          .get(id)) as any;
        if (!kinds.includes(job.kind))
          throw new QBError('DENIED', 'Executor cannot complete this job kind', 403);
        if (job.state !== 'leased' || lease.lease_token !== leaseToken || job.leaseUntil! <= now)
          throw new QBError(
            'LEASE_CONFLICT',
            'Job lease no longer valid; reconcile side effects',
            409,
          );
        const delay = Math.min(300000, 1000 * 2 ** (job.attempts - 1));
        const state = result.success
          ? 'succeeded'
          : result.retryable && job.attempts < job.maxAttempts && now + delay < job.deadlineAt
            ? 'retry_wait'
            : 'dead';
        const code = result.code ?? null;
        await tx
          .query(
            `UPDATE _qb_jobs SET state=?,available_at=?,lease_token=NULL,lease_until=NULL,
        updated_at=?,last_code=? WHERE id=?`,
          )
          .run(state, now + delay, now, code, id);
        await tx
          .query(
            'UPDATE _qb_job_attempts SET finished_at=?,outcome=?,code=? WHERE job_id=? AND attempt=?',
          )
          .run(now, state, code, id, job.attempts);
        return await this.get(id);
      })
      .immediate();
  }
  async cancel(id: string): Promise<JobSummary> {
    return await this.db
      .transaction(async (tx) => {
        const job = await this.get(id);
        if (terminal.includes(job.state)) return job;
        const now = this.clock();
        await tx
          .query(
            "UPDATE _qb_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
          )
          .run(now, id);
        await tx
          .query(
            "UPDATE _qb_job_attempts SET finished_at=?,outcome='cancelled' WHERE job_id=? AND finished_at IS NULL",
          )
          .run(now, id);
        return await this.get(id);
      })
      .immediate();
  }
  async replay(id: string, idempotencyKey: string): Promise<JobSummary> {
    text(idempotencyKey, 100);
    return await this.db
      .transaction(async (tx) => {
        const job = await this.get(id);
        if (job.state !== 'dead')
          throw new QBError('JOB_STATE', 'Only dead jobs can be explicitly replayed', 409);
        const payload = ((await tx.query('SELECT payload FROM _qb_jobs WHERE id=?').get(id)) as any)
          .payload;
        return await this.submit({
          kind: job.kind,
          eventId: job.eventId,
          payload: this.codec.open(payload),
          deduplicationKey: createHash('sha256')
            .update(`replay:${id}:${idempotencyKey}`)
            .digest('hex'),
          parentId: id,
        });
      })
      .immediate();
  }
  async cleanup(): Promise<number> {
    return await this.db
      .transaction(async (tx) => {
        const now = this.clock();
        await this.expire(now);
        // Deduplication is retained for the full history window, not just until success.
        return (
          await tx
            .query(
              "DELETE FROM _qb_jobs WHERE state IN('succeeded','dead','cancelled') AND updated_at<=?",
            )
            .run(now - 30 * 86400000)
        ).changes;
      })
      .immediate();
  }
}
