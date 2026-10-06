import { QBError, type Result } from '@qb-flex/contracts';
export class ManagementClient {
  constructor(
    readonly url: string,
    private token?: string,
  ) {}
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
