import { QBError, type Result } from '@qb-flex/contracts';
import type { JobSummary, JobAttempt } from '../../contracts/src/jobs';
import type { WebhookInput, WebhookSummary } from '@qb-flex/contracts';
import type { SecurityReport, SecurityFinding } from '@qb-flex/contracts';
import type {
  AlertRule,
  AlertRuleInput,
  AssistantRequest,
  AssistantResponse,
  NotificationSummary,
  PreviewInput,
  PreviewSummary,
  QueryPlanResult,
  QuerySample,
  RealtimeDebugSession,
  SchemaReviewDetail,
  SchemaReviewInput,
  SchemaReviewSummary,
  SearchCollectionInput,
  SearchCollectionSummary,
} from '@qb-flex/contracts';

/** Signed sample built for a subscription. Bodies are synthetic, not production rows. */
export interface WebhookSample {
  eventId: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** Result of delivering that signed sample to the configured receiver. */
export interface WebhookSampleDelivery {
  delivered: boolean;
  status: number | null;
  skipped: boolean;
  code: string | null;
}
import type {
  RecoverySettings,
  RecoveryDestinationSummary,
  RecoveryDestinationInput,
  RecoveryInventory,
  RecoveryDrillSummary,
} from '@qb-flex/contracts';
export class ManagementClient {
  constructor(
    readonly url: string,
    private token?: string,
  ) {}
  recovery(projectId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/recovery`;
    return {
      settings: (signal?: AbortSignal) =>
        this.request<RecoverySettings>(base, 'GET', undefined, signal),
      update: (input: Partial<RecoverySettings>, version: number, signal?: AbortSignal) =>
        this.request<RecoverySettings>(base, 'PUT', input, signal, {
          'if-match': String(version),
        }),
      destinations: (signal?: AbortSignal) =>
        this.request<RecoveryDestinationSummary[]>(
          `${base}/destinations`,
          'GET',
          undefined,
          signal,
        ),
      addDestination: (input: RecoveryDestinationInput, signal?: AbortSignal) =>
        this.request<RecoveryDestinationSummary>(`${base}/destinations`, 'POST', input, signal),
      destinationState: (
        id: string,
        state: 'active' | 'disabled',
        signal?: AbortSignal,
      ) =>
        this.request<RecoveryDestinationSummary>(
          `${base}/destinations/${encodeURIComponent(id)}/state`,
          'POST',
          { state },
          signal,
        ),
      inventory: (signal?: AbortSignal) =>
        this.request<RecoveryInventory>(`${base}/inventory`, 'GET', undefined, signal),
      drills: (signal?: AbortSignal) =>
        this.request<RecoveryDrillSummary[]>(`${base}/drills`, 'GET', undefined, signal),
      startDrill: (backupId: string, signal?: AbortSignal) =>
        this.request<RecoveryDrillSummary>(`${base}/drills`, 'POST', { backupId }, signal),
      cancelDrill: (id: string, signal?: AbortSignal) =>
        this.request<RecoveryDrillSummary>(
          `${base}/drills/${encodeURIComponent(id)}/cancel`,
          'POST',
          undefined,
          signal,
        ),
    };
  }
  security(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/security`;
    return {
      scan: (signal?: AbortSignal) => this.request<SecurityReport>(base, 'GET', undefined, signal),
      acknowledge: (id: string, expiresAt: number, signal?: AbortSignal) =>
        this.request<SecurityFinding>(
          `${base}/${encodeURIComponent(id)}/acknowledge`,
          'POST',
          { expiresAt },
          signal,
        ),
      clear: (id: string, signal?: AbortSignal) =>
        this.request<{ cleared: boolean }>(
          `${base}/${encodeURIComponent(id)}/acknowledge`,
          'DELETE',
          undefined,
          signal,
        ),
    };
  }
  webhooks(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/webhooks`;
    return {
      list: (signal?: AbortSignal) =>
        this.request<WebhookSummary[]>(base, 'GET', undefined, signal),
      create: (input: WebhookInput, signal?: AbortSignal) =>
        this.request<WebhookSummary & { signingSecret: string }>(base, 'POST', input, signal),
      state: (id: string, state: 'active' | 'paused' | 'revoked', signal?: AbortSignal) =>
        this.request<WebhookSummary>(
          `${base}/${encodeURIComponent(id)}/state`,
          'POST',
          { state },
          signal,
        ),
      rotate: (id: string, signal?: AbortSignal) =>
        this.request<WebhookSummary & { signingSecret: string }>(
          `${base}/${encodeURIComponent(id)}/rotate`,
          'POST',
          undefined,
          signal,
        ),
      sample: (id: string, signal?: AbortSignal) =>
        this.request<WebhookSample>(
          `${base}/${encodeURIComponent(id)}/sample`,
          'POST',
          undefined,
          signal,
        ),
      deliverSample: (id: string, signal?: AbortSignal) =>
        this.request<WebhookSampleDelivery>(
          `${base}/${encodeURIComponent(id)}/deliver-sample`,
          'POST',
          undefined,
          signal,
        ),
    };
  }
  reviews(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/reviews`;
    return {
      list: (signal?: AbortSignal) =>
        this.request<SchemaReviewSummary[]>(base, 'GET', undefined, signal),
      create: (input: SchemaReviewInput, signal?: AbortSignal) =>
        this.request<SchemaReviewDetail>(base, 'POST', input, signal),
      get: (id: string, signal?: AbortSignal) =>
        this.request<SchemaReviewDetail>(
          `${base}/${encodeURIComponent(id)}`,
          'GET',
          undefined,
          signal,
        ),
      rehearse: (id: string, signal?: AbortSignal) =>
        this.request<SchemaReviewDetail>(
          `${base}/${encodeURIComponent(id)}/rehearse`,
          'POST',
          undefined,
          signal,
        ),
      approve: (id: string, signal?: AbortSignal) =>
        this.request<SchemaReviewDetail>(
          `${base}/${encodeURIComponent(id)}/approve`,
          'POST',
          undefined,
          signal,
        ),
      reject: (id: string, signal?: AbortSignal) =>
        this.request<SchemaReviewDetail>(
          `${base}/${encodeURIComponent(id)}/reject`,
          'POST',
          undefined,
          signal,
        ),
    };
  }
  previews(projectId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/previews`;
    return {
      list: (signal?: AbortSignal) =>
        this.request<PreviewSummary[]>(base, 'GET', undefined, signal),
      create: (input: PreviewInput, signal?: AbortSignal) =>
        this.request<PreviewSummary>(base, 'POST', input, signal),
      get: (id: string, signal?: AbortSignal) =>
        this.request<PreviewSummary>(
          `${base}/${encodeURIComponent(id)}`,
          'GET',
          undefined,
          signal,
        ),
      extend: (id: string, ttlHours?: number, signal?: AbortSignal) =>
        this.request<PreviewSummary>(
          `${base}/${encodeURIComponent(id)}/extend`,
          'POST',
          ttlHours === undefined ? {} : { ttlHours },
          signal,
        ),
      remove: (id: string, signal?: AbortSignal) =>
        this.request<{ deleted: boolean }>(
          `${base}/${encodeURIComponent(id)}`,
          'DELETE',
          undefined,
          signal,
        ),
    };
  }
  searchCollections(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/search/collections`;
    return {
      list: (signal?: AbortSignal) =>
        this.request<SearchCollectionSummary[]>(base, 'GET', undefined, signal),
      create: (input: SearchCollectionInput, signal?: AbortSignal) =>
        this.request<SearchCollectionSummary>(base, 'POST', input, signal),
      rebuild: (id: string, signal?: AbortSignal) =>
        this.request<SearchCollectionSummary>(
          `${base}/${encodeURIComponent(id)}/rebuild`,
          'POST',
          undefined,
          signal,
        ),
      remove: (id: string, signal?: AbortSignal) =>
        this.request<{ deleted: boolean }>(
          `${base}/${encodeURIComponent(id)}`,
          'DELETE',
          undefined,
          signal,
        ),
    };
  }
  inspector(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/inspector`;
    return {
      samples: (signal?: AbortSignal) =>
        this.request<QuerySample[]>(`${base}/samples`, 'GET', undefined, signal),
      plan: (fingerprint: string, signal?: AbortSignal) =>
        this.request<QueryPlanResult>(`${base}/plan`, 'POST', { fingerprint }, signal),
    };
  }
  realtimeDebug(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/realtime/debug`;
    return {
      list: (signal?: AbortSignal) =>
        this.request<RealtimeDebugSession[]>(base, 'GET', undefined, signal),
      open: (
        input: { identitySub: string | null; identityRole: string },
        signal?: AbortSignal,
      ) => this.request<RealtimeDebugSession>(base, 'POST', input, signal),
    };
  }
  assistant(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/assistant`;
    return {
      propose: (body: AssistantRequest, signal?: AbortSignal) =>
        this.request<AssistantResponse>(base, 'POST', body, signal),
    };
  }
  alerts(orgId: string) {
    const base = `/organizations/${encodeURIComponent(orgId)}`;
    return {
      listRules: (signal?: AbortSignal) =>
        this.request<AlertRule[]>(`${base}/alert-rules`, 'GET', undefined, signal),
      createRule: (input: AlertRuleInput, signal?: AbortSignal) =>
        this.request<AlertRule>(`${base}/alert-rules`, 'POST', input, signal),
      getRule: (id: string, signal?: AbortSignal) =>
        this.request<AlertRule>(`${base}/alert-rules/${encodeURIComponent(id)}`, 'GET', undefined, signal),
      deleteRule: (id: string, signal?: AbortSignal) =>
        this.request<void>(`${base}/alert-rules/${encodeURIComponent(id)}`, 'DELETE', undefined, signal),
      notifications: (signal?: AbortSignal) =>
        this.request<NotificationSummary[]>(`${base}/notifications`, 'GET', undefined, signal),
      markRead: (id: string, signal?: AbortSignal) =>
        this.request<{ id: string; readAt: string }>(
          `${base}/notifications/${encodeURIComponent(id)}/read`,
          'POST',
          undefined,
          signal,
        ),
    };
  }
  jobs(projectId: string, branchId: string) {
    const base = `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/jobs`;
    return {
      list: (options: { limit?: number; cursor?: string; signal?: AbortSignal } = {}) => {
        const query = new URLSearchParams();
        if (options.limit !== undefined) query.set('limit', String(options.limit));
        if (options.cursor) query.set('cursor', options.cursor);
        return this.request<JobSummary[]>(
          base + (query.size ? '?' + query : ''),
          'GET',
          undefined,
          options.signal,
        );
      },
      get: (id: string, signal?: AbortSignal) =>
        this.request<JobSummary & { history: JobAttempt[] }>(
          `${base}/${encodeURIComponent(id)}`,
          'GET',
          undefined,
          signal,
        ),
      cancel: (id: string, signal?: AbortSignal) =>
        this.request<JobSummary>(
          `${base}/${encodeURIComponent(id)}/cancel`,
          'POST',
          undefined,
          signal,
        ),
      replay: (id: string, idempotencyKey: string, signal?: AbortSignal) =>
        this.request<JobSummary>(
          `${base}/${encodeURIComponent(id)}/replay`,
          'POST',
          undefined,
          signal,
          { 'idempotency-key': idempotencyKey },
        ),
    };
  }
  async request<T = any>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): Promise<Result<T>> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-request-id': crypto.randomUUID(),
      ...extraHeaders,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url + '/management/v1' + path, {
      method,
      headers,
      credentials: 'include',
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok)
      throw new QBError(
        value.error?.code ?? 'REQUEST_FAILED',
        value.error?.message ?? 'Management operation failed',
        response.status,
        value.error?.retryable,
      );
    return value;
  }
  async transfer(path: string, method = 'GET', body?: Blob) {
    const response = await fetch(this.url + '/management/v1' + path, {
      method,
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      credentials: 'include',
      body,
    });
    if (!response.ok) {
      const value = await response.json().catch(() => null);
      throw new QBError(
        value?.error?.code ?? 'REQUEST_FAILED',
        value?.error?.message ?? 'Transfer failed',
        response.status,
      );
    }
    return method === 'GET' ? response.blob() : response.json();
  }
  async text(path: string) {
    const response = await fetch(this.url + '/management/v1' + path, {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      credentials: 'include',
    });
    if (!response.ok) throw new QBError('REQUEST_FAILED', 'Download failed', response.status);
    return response.text();
  }
}
