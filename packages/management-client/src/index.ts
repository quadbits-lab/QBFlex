import { QBError, type Result } from '@qb-flex/contracts';
import type { JobSummary, JobAttempt } from '../../contracts/src/jobs';
import type { WebhookInput, WebhookSummary } from '@qb-flex/contracts';
import type { SecurityReport, SecurityFinding } from '@qb-flex/contracts';
export class ManagementClient {
  constructor(
    readonly url: string,
    private token?: string,
  ) {}
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
