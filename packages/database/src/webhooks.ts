import { createHmac, randomBytes } from 'node:crypto';
import {
  QBError,
  type WebhookInput,
  type WebhookSummary,
  type WebhookDelivery,
  type WebhookSkip,
} from '@qb-flex/contracts';
import { schema, schemaVersion } from '@qb-flex/schema';
import type { BranchEngine } from './engine';
import type { DurableJobs } from './jobs';
interface Definition extends WebhookInput {
  secret: string;
  previousSecret?: string;
  rotationUntil?: number;
}
interface Codec {
  seal(value: unknown): string;
  open(value: string): any;
}
interface Row {
  id: string;
  definition: string;
  state: WebhookSummary['state'];
  checkpoint: number | bigint;
  created_at: number | bigint;
  updated_at: number | bigint;
}
function invalid(message: string): never {
  throw new QBError('VALIDATION', message);
}
/** Owner-only subscription catalog. Jobs contain references, not captured protected rows. */
export class Webhooks {
  constructor(
    private engine: BranchEngine,
    private jobs: DurableJobs,
    private codec: Codec,
    private branchId: string,
    private clock = Date.now,
  ) {}
  async initialize() {
    await this.engine.db.exec(`CREATE TABLE IF NOT EXISTS _qb_webhooks(
      id TEXT PRIMARY KEY,definition TEXT NOT NULL,state TEXT NOT NULL,
      checkpoint BIGINT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);`);
    return this;
  }
  private async row(id: string): Promise<Row> {
    if (typeof id !== 'string' || id.length > 100) invalid('Invalid webhook identifier');
    const row = (await this.engine.db
      .query('SELECT * FROM _qb_webhooks WHERE id=?')
      .get(id)) as Row | null;
    if (!row) throw new QBError('NOT_FOUND', 'Webhook not available', 404);
    return row;
  }
  private definition(row: Row): Definition {
    try {
      return this.codec.open(row.definition);
    } catch {
      throw new QBError('PAYLOAD_INTEGRITY', 'Webhook configuration failed authentication', 409);
    }
  }
  private summary(row: Row): WebhookSummary {
    const def = this.definition(row);
    return {
      id: row.id,
      name: def.name,
      destinationOrigin: new URL(def.url).origin,
      serviceKeyId: def.serviceKeyId,
      table: def.table,
      events: def.events,
      columns: def.columns,
      state: row.state,
      checkpoint: Number(row.checkpoint),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      rotationUntil: (def.rotationUntil ?? 0) > this.clock() ? def.rotationUntil! : null,
    };
  }
  async list(): Promise<WebhookSummary[]> {
    return (
      (await this.engine.db
        .query(
          "SELECT * FROM _qb_webhooks ORDER BY (state='revoked'),created_at DESC,id DESC LIMIT 100",
        )
        .all()) as Row[]
    ).map((row) => this.summary(row));
  }
  async create(input: WebhookInput): Promise<
    WebhookSummary & {
      signingSecret: string;
    }
  > {
    if (
      !input ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 80 ||
      typeof input.url !== 'string' ||
      input.url.length > 2048 ||
      typeof input.serviceKeyId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(input.serviceKeyId) ||
      !Array.isArray(input.events) ||
      !input.events.length ||
      input.events.length > 3 ||
      input.events.some((e) => !['insert', 'update', 'delete'].includes(e)) ||
      !Array.isArray(input.columns) ||
      !input.columns.length ||
      input.columns.length > 100 ||
      input.columns.some((c) => typeof c !== 'string')
    )
      invalid('Invalid webhook configuration');
    // Network validation also runs in the API and on every worker dispatch.
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return invalid('Invalid webhook URL');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
      invalid('Webhooks require HTTPS without credentials, query strings or fragments');
    const table = this.engine.table(input.table);
    if (input.columns.some((c) => !table.allowedColumns.includes(c)))
      invalid('Webhook columns must be exposed');
    // Deletion keys must not accidentally disclose a non-exposed primary key.
    if (
      !table.columns.some((c) => c.primaryKey) ||
      table.columns.some((c) => c.primaryKey && !input.columns.includes(c.name))
    )
      invalid('Webhook columns must include every exposed primary key');
    return await this.engine.db
      .transaction(async (tx) => {
        if (
          Number(
            (
              (await tx
                .query("SELECT count(*) AS n FROM _qb_webhooks WHERE state<>'revoked'")
                .get()) as any
            ).n,
          ) >= 20
        )
          throw new QBError('QUOTA', 'At most 20 subscriptions per branch', 429);
        if (
          Number(((await tx.query('SELECT count(*) AS n FROM _qb_webhooks').get()) as any).n) >=
          1000
        )
          throw new QBError('QUOTA', 'Webhook history capacity reached', 429);
        const id = crypto.randomUUID(),
          secret = randomBytes(32).toString('base64url'),
          now = this.clock();
        const def: Definition = {
          name: input.name.trim(),
          url: url.href,
          table: table.name,
          serviceKeyId: input.serviceKeyId,
          events: [...new Set(input.events)],
          columns: [...new Set(input.columns)],
          secret,
        };
        await tx
          .query("INSERT INTO _qb_webhooks VALUES(?,?,'active',?,?,?)")
          .run(id, this.codec.seal(def), await this.engine.latest(), now, now);
        return { ...this.summary(await this.row(id)), signingSecret: secret };
      })
      .immediate();
  }
  async state(id: string, state: 'active' | 'paused' | 'revoked'): Promise<WebhookSummary> {
    if (!['active', 'paused', 'revoked'].includes(state)) invalid('Invalid webhook state');
    return await this.engine.db
      .transaction(async (tx) => {
        const row = await this.row(id);
        if (row.state === 'revoked')
          throw new QBError('WEBHOOK_STATE', 'Revoked subscription cannot resume', 409);
        if (row.state === 'resync_required' && state === 'active')
          throw new QBError(
            'RESYNC_REQUIRED',
            'Create a new subscription after reconciling the replay gap',
            409,
          );
        await tx
          .query('UPDATE _qb_webhooks SET state=?,updated_at=? WHERE id=?')
          .run(state, this.clock(), id);
        return this.summary(await this.row(id));
      })
      .immediate();
  }
  async rotate(id: string): Promise<
    WebhookSummary & {
      signingSecret: string;
    }
  > {
    return await this.engine.db
      .transaction(async (tx) => {
        const row = await this.row(id),
          def = this.definition(row),
          now = this.clock();
        if (row.state === 'revoked')
          throw new QBError('WEBHOOK_STATE', 'Subscription revoked', 409);
        if ((def.rotationUntil ?? 0) > now)
          throw new QBError('WEBHOOK_STATE', 'Previous rotation overlap still active', 409);
        const secret = randomBytes(32).toString('base64url');
        await tx.query('UPDATE _qb_webhooks SET definition=?,updated_at=? WHERE id=?').run(
          this.codec.seal({
            ...def,
            previousSecret: def.secret,
            secret,
            rotationUntil: now + 86400000,
          }),
          now,
          id,
        );
        return { ...this.summary(await this.row(id)), signingSecret: secret };
      })
      .immediate();
  }
  /** At most 200 outbox rows/subscription and 200 jobs/owner call. Atomic checkpoint + jobs. */
  async produce(): Promise<{
    submitted: number;
    gaps: number;
  }> {
    return await this.engine.db
      .transaction(async (tx) => {
        let submitted = 0,
          gaps = 0;
        await tx
          .query("DELETE FROM _qb_webhooks WHERE state='revoked' AND updated_at<=?")
          .run(this.clock() - 30 * 86400000);
        const floor = Number(
          ((await tx.query("SELECT value FROM _qb_meta WHERE key='outbox_floor'").get()) as any)
            ?.value ?? 0,
        );
        const rows = (await tx
          .query("SELECT * FROM _qb_webhooks WHERE state='active' ORDER BY updated_at,id LIMIT 20")
          .all()) as Row[];
        for (const subscription of rows) {
          if (submitted >= 200) break;
          const checkpoint = Number(subscription.checkpoint),
            def = this.definition(subscription);
          if (checkpoint < floor) {
            await tx
              .query("UPDATE _qb_webhooks SET state='resync_required',updated_at=? WHERE id=?")
              .run(this.clock(), subscription.id);
            gaps++;
            continue;
          }
          const events = (await tx
            .query(
              'SELECT seq,table_name,operation FROM _qb_outbox WHERE seq>? ORDER BY seq LIMIT ?',
            )
            .all(checkpoint, 200 - submitted)) as any[];
          for (const event of events) {
            const sequence = Number(event.seq);
            if (event.table_name === def.table && def.events.includes(event.operation)) {
              const eventId = `${this.branchId}:${sequence}:${subscription.id}`;
              await this.jobs.submit({
                kind: 'webhook.delivery',
                deduplicationKey: eventId,
                eventId,
                payload: { subscriptionId: subscription.id, sequence },
              });
              submitted++;
            }
            await tx
              .query('UPDATE _qb_webhooks SET checkpoint=?,updated_at=? WHERE id=?')
              .run(sequence, this.clock(), subscription.id);
          }
        }
        return { submitted, gaps };
      })
      .immediate();
  }
  async reference(id: string, leaseToken: string) {
    const payload = (await this.jobs.leased(id, leaseToken, ['webhook.delivery'])) as any;
    if (
      !payload ||
      typeof payload.subscriptionId !== 'string' ||
      !Number.isSafeInteger(payload.sequence) ||
      payload.sequence < 1
    )
      throw new QBError('PAYLOAD_INTEGRITY', 'Invalid webhook job reference', 409);
    const row = await this.row(payload.subscriptionId),
      def = this.definition(row);
    return { serviceKeyId: def.serviceKeyId, table: def.table };
  }
  async prepare(
    id: string,
    leaseToken: string,
    serviceKeyId: string,
  ): Promise<WebhookDelivery | WebhookSkip> {
    const payload = (await this.jobs.leased(id, leaseToken, ['webhook.delivery'])) as {
      subscriptionId: string;
      sequence: number;
    };
    const row = await this.row(payload.subscriptionId),
      def = this.definition(row);
    if (row.state !== 'active') return { skipped: true, code: 'SUBSCRIPTION_INACTIVE' };
    if (def.serviceKeyId !== serviceKeyId) return { skipped: true, code: 'KEY_SCOPE' };
    const table = (await schema(this.engine.db)).find((t) => t.name === def.table && t.exposed);
    if (!table || def.columns.some((c) => !table.allowedColumns.includes(c)))
      return { skipped: true, code: 'NOT_AUTHORIZED' };
    const exists = await this.engine.db
      .query('SELECT 1 FROM _qb_outbox WHERE seq=?')
      .get(payload.sequence);
    if (!exists) return { skipped: true, code: 'EVENT_EXPIRED' };
    let replay;
    try {
      replay = await this.engine.events(
        payload.sequence - 1,
        { sub: serviceKeyId, role: 'service', roles: [] },
        def.table,
        payload.sequence,
      );
    } catch (error) {
      if (error instanceof QBError && error.code === 'RESYNC_REQUIRED')
        return { skipped: true, code: 'EVENT_TOO_LARGE' };
      throw error;
    }
    const event = replay.events.find((e) => e.eventId === String(payload.sequence));
    if (!event || !def.events.includes(event.event as any))
      return { skipped: true, code: 'NOT_AUTHORIZED' };
    const eventId = (await this.jobs.get(id)).eventId;
    const body = JSON.stringify({
      eventId,
      type: 'database',
      table: def.table,
      event: event.event,
      payload: Object.fromEntries(
        Object.entries(event.payload as Record<string, unknown>).filter(([key]) =>
          def.columns.includes(key),
        ),
      ),
      schemaVersion: await schemaVersion(this.engine.db),
    });
    if (Buffer.byteLength(body) > 65536) return { skipped: true, code: 'EVENT_TOO_LARGE' };
    const timestamp = String(Math.floor(this.clock() / 1000));
    const sign = (secret: string) =>
      createHmac('sha256', secret).update(`${timestamp}.${eventId}.`).update(body).digest('hex');
    const signatures = [sign(def.secret)];
    if (def.previousSecret && (def.rotationUntil ?? 0) > this.clock())
      signatures.push(sign(def.previousSecret));
    return {
      skipped: false,
      url: def.url,
      body,
      headers: {
        'content-type': 'application/json',
        'x-qb-event-id': eventId,
        'x-qb-timestamp': timestamp,
        'x-qb-signature': signatures.map((s) => `v1=${s}`).join(','),
      },
    };
  }
}
