import type { JobSummary, WebhookDelivery, WebhookSkip } from '@qb-flex/contracts';
import { deliverWebhook, type DeliveryResult, type InternalAllowlist } from './webhook-delivery';

interface Target {
  projectId: string;
  branchId: string;
}
interface Envelope<T> {
  data: T;
  meta: { cursor?: string };
}
interface Claim extends JobSummary {
  leaseToken: string;
  payload?: { drillId?: string; projectId?: string; backupId?: string };
}
/** Does not open SQLite or know signing secrets. At-least-once delivery; receivers deduplicate. */
export class JobExecutor {
  private cursor?: string;
  private targets: Target[] = [];
  private busy = false;
  constructor(
    private api: string,
    private token: string,
    private options: {
      allowlist?: InternalAllowlist;
      fetch?: typeof fetch;
      deliver?: (delivery: WebhookDelivery, signal: AbortSignal) => Promise<DeliveryResult>;
      clock?: () => number;
    } = {},
  ) {
    const url = new URL(api);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid private API URL');
  }
  private async call<T>(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    timeoutMs = 5000,
  ): Promise<Envelope<T>> {
    const response = await (this.options.fetch ?? fetch)(this.api + path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('Private job operation failed');
    return response.json();
  }
  async tick(signal = new AbortController().signal) {
    if (this.busy) return { busy: true, finished: 0 };
    this.busy = true;
    let finished = 0;
    const clock = this.options.clock ?? Date.now,
      started = clock();
    try {
      if (!this.targets.length) {
        const page = await this.call<Target[]>(
          '/internal/jobs/targets?limit=8' +
            (this.cursor ? '&cursor=' + encodeURIComponent(this.cursor) : ''),
          signal,
        );
        this.targets = page.data;
        this.cursor = page.meta.cursor;
      }
      while (this.targets.length && finished < 20 && clock() - started < 20000 && !signal.aborted) {
        const target = this.targets[0]!;
        try {
          await this.call('/internal/webhooks/produce', signal, target);
          // Work per branch is bounded so one tenant cannot monopolize the whole worker.
          for (
            let i = 0;
            i < 2 && finished < 20 && clock() - started < 20000 && !signal.aborted;
            i++
          ) {
            const claimed = (
              await this.call<Claim | null>('/internal/jobs/claim', signal, {
                ...target,
                executor: 'webhooks',
              })
            ).data;
            if (!claimed) break;
            let result: DeliveryResult;
            if (claimed.kind !== 'webhook.delivery') {
              // Other executors are not implemented: never acknowledge their effects as successful.
              result = { success: false, code: 'EXECUTOR_UNAVAILABLE' };
            } else {
              const prepared = (
                await this.call<WebhookDelivery | WebhookSkip>(
                  '/internal/webhooks/prepare',
                  signal,
                  { ...target, id: claimed.id, leaseToken: claimed.leaseToken },
                )
              ).data;
              result = prepared.skipped
                ? { success: true, code: prepared.code }
                : await (
                    this.options.deliver ??
                    ((delivery, cancellation) =>
                      deliverWebhook(delivery, {
                        allowlist: this.options.allowlist,
                        signal: cancellation,
                      }))
                  )(prepared, signal);
            }
            await this.call('/internal/jobs/finish', signal, {
              ...target,
              id: claimed.id,
              leaseToken: claimed.leaseToken,
              result,
            });
            finished++;
          }
          for (
            let i = 0;
            i < 1 && finished < 20 && clock() - started < 20000 && !signal.aborted;
            i++
          ) {
            const claimed = (
              await this.call<Claim | null>('/internal/jobs/claim', signal, {
                ...target,
                executor: 'recovery',
                leaseMs: 60000,
              })
            ).data;
            if (!claimed) break;
            let result: DeliveryResult;
            if (claimed.kind !== 'recovery.drill') {
              result = { success: false, code: 'EXECUTOR_UNAVAILABLE' };
            } else {
              const drillId = claimed.payload?.drillId;
              if (typeof drillId !== 'string') {
                result = { success: false, code: 'PAYLOAD_INTEGRITY' };
              } else {
                try {
                  await this.call(
                    '/internal/recovery/execute',
                    signal,
                    { drillId, projectId: target.projectId },
                    150000,
                  );
                  result = { success: true, code: 'DRILL_COMPLETED' };
                } catch {
                  result = { success: false, retryable: true, code: 'DRILL_FAILED' };
                }
              }
            }
            await this.call('/internal/jobs/finish', signal, {
              ...target,
              id: claimed.id,
              leaseToken: claimed.leaseToken,
              result,
            });
            finished++;
          }
        } finally {
          this.targets.shift();
          // Close only transient executor-created owners; application-owned workers stay alive.
          await this.call('/internal/jobs/release', signal, target).catch(() => {});
        }
      }
      return { busy: false, finished };
    } finally {
      this.busy = false;
    }
  }
}
