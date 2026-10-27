import {
  QBError,
  type DatabaseShape,
  type RowOf,
  type InsertOf,
  type UpdateOf,
  type Query,
  type Result,
  type Session,
  type Filter,
  type AggregateExpr,
  type HavingClause,
  type RelationsOf,
} from '@qb-flex/contracts';
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
export { QBError } from '@qb-flex/contracts';
export type { Result, Session, Query } from '@qb-flex/contracts';
export interface ClientOptions {
  url: string;
  projectId: string;
  branch?: string;
  publishableKey: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  credentials?: RequestCredentials;
}
export interface RequestOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  revision?: number;
}
export interface DatabaseEvent {
  type: 'database';
  eventId: string;
  table: string;
  event: 'insert' | 'update' | 'delete';
  payload: Record<string, unknown>;
  schemaVersion: number;
}
export interface ChannelOptions {
  table: string;
  cursor?: string;
  onEvent: (event: DatabaseEvent) => void;
  onStatus?: (status: string) => void;
  onResync?: () => void;
}
/** Create one client per application or SSR request. Only publishable keys belong in browser bundles. */
export type RPCShape = Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
export function createClient<D = DatabaseShape, R = RPCShape>(options: ClientOptions) {
  return new QBClient<D, R>(options);
}
export class QBClient<D = DatabaseShape, R = RPCShape> {
  readonly baseURL: string;
  readonly scope: string;
  private token: string | null = null;
  private session: Session | null = null;
  private listeners = new Set<(session: Session | null) => void>();
  private refreshPromise: Promise<Session | null> | null = null;
  private channels = new Set<QBChannel>();
  private disposed = false;
  private epoch = 0;
  private pending = new Set<AbortController>();
  private betterAuthClient: any | null = null;
  constructor(readonly options: ClientOptions) {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new QBError('CONFIG', 'Use an absolute HTTP(S) API URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new QBError(
        'CONFIG',
        'Use an HTTP(S) API URL without credentials, query parameters or fragments',
      );
    this.baseURL = `${options.url.replace(/\/$/, '')}/v1/projects/${encodeURIComponent(options.projectId)}/branches/${encodeURIComponent(options.branch ?? 'primary')}`;
    this.scope = `${options.url}/${options.projectId}/${options.branch ?? 'primary'}`;
  }
  getSession() {
    return this.session;
  }
  /**
   * Better-auth client for WebAuthn ceremonies against the branch auth realm.
   * The custom fetch injects the publishable key plus the current bearer
   * session on every request, mirroring `request()` header behavior.
   */
  private authClient() {
    if (!this.betterAuthClient) {
      const client = this;
      this.betterAuthClient = createAuthClient({
        baseURL: this.baseURL + '/auth',
        plugins: [passkeyClient(), twoFactorClient(), magicLinkClient()],
        fetchOptions: {
          customFetchImpl: async (input, init) => {
            const headers = new Headers(init?.headers);
            headers.set('x-qb-key', client.options.publishableKey);
            if (client.token) headers.set('authorization', `Bearer ${client.token}`);
            return await fetch(input, { ...init, headers, credentials: 'include' });
          },
        },
      });
    }
    return this.betterAuthClient;
  }
  getIdentityVersion() {
    return this.epoch;
  }
  getToken() {
    return this.token;
  }
  onAuthStateChange(listener: (session: Session | null) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private setSession(session: Session | null, token?: string | null) {
    const before = this.session?.user.id;
    this.session = session;
    if (token !== undefined) this.token = token;
    if (before !== session?.user.id) {
      this.epoch++;
      for (const pending of this.pending)
        pending.abort(new QBError('IDENTITY_CHANGED', 'Application identity changed', 499));
      for (const channel of this.channels) channel.reauthenticate();
    }
    for (const listener of this.listeners) listener(session);
  }
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    options: RequestOptions & {
      safe?: boolean;
      raw?: boolean;
      auth?: boolean;
      refresh?: boolean;
    } = {},
  ): Promise<T> {
    if (this.disposed) throw new QBError('DISPOSED', 'Client has been disposed');
    const fetcher = this.options.fetch ?? globalThis.fetch;
    let attempt = 0;
    let currentSignal: AbortSignal | undefined, currentTimeout: AbortSignal | undefined;
    const cancellation = new AbortController();
    this.pending.add(cancellation);
    try {
      while (true) {
        const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15000);
        const signal = AbortSignal.any([
          timeout,
          cancellation.signal,
          ...(options.signal ? [options.signal] : []),
        ]);
        currentSignal = signal;
        currentTimeout = timeout;
        const headers: Record<string, string> = {
          'x-qb-key': this.options.publishableKey,
          'x-request-id': crypto.randomUUID(),
        };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
        if (options.revision !== undefined) headers['if-match'] = String(options.revision);
        const binary =
          (typeof Blob !== 'undefined' && body instanceof Blob) || body instanceof Uint8Array;
        if (body !== undefined && !binary) headers['content-type'] = 'application/json';
        let response: Response;
        try {
          response = await fetcher(this.baseURL + path, {
            method,
            headers,
            signal,
            credentials: this.options.credentials ?? 'include',
            body:
              body === undefined ? undefined : binary ? (body as BodyInit) : JSON.stringify(body),
          });
        } catch (error) {
          if (signal.aborted)
            throw new QBError(
              timeout.aborted ? 'TIMEOUT' : 'ABORTED',
              timeout.aborted ? 'Request timed out' : 'Request was cancelled',
              timeout.aborted ? 408 : 499,
              timeout.aborted,
            );
          if ((method === 'GET' || options.safe || options.idempotencyKey) && attempt++ < 2) {
            await this.delay(attempt, signal);
            continue;
          }
          throw new QBError('NETWORK', 'Unable to reach QB Flex', 0, true);
        }
        const rotated = response.headers.get('set-auth-token');
        if (rotated) this.token = rotated;
        if (response.ok) {
          if (options.raw) return (await response.blob()) as T;
          if (response.status === 204) return undefined as T;
          return (await response.json()) as T;
        }
        if (
          response.status === 401 &&
          !options.auth &&
          options.refresh !== false &&
          this.token &&
          attempt++ === 0
        ) {
          if (await this.auth.refreshSession()) continue;
        }
        const value = await response.json().catch(() => null);
        const error = new QBError(
          value?.error?.code ?? value?.code ?? 'REQUEST_FAILED',
          value?.error?.message ?? value?.message ?? `Request failed (${response.status})`,
          response.status,
          value?.error?.retryable ?? false,
          value?.error?.details,
        );
        if (
          error.retryable &&
          (method === 'GET' || options.safe || options.idempotencyKey) &&
          attempt++ < 2
        ) {
          await this.delay(attempt, signal);
          continue;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof QBError) throw error;
      if (currentSignal?.aborted)
        throw new QBError(
          currentTimeout?.aborted ? 'TIMEOUT' : 'ABORTED',
          currentTimeout?.aborted ? 'Request timed out' : 'Request was cancelled',
          currentTimeout?.aborted ? 408 : 499,
          !!currentTimeout?.aborted,
        );
      throw new QBError('PROTOCOL', 'QB Flex returned an invalid response', 502);
    } finally {
      this.pending.delete(cancellation);
    }
  }
  private delay(attempt: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
        Math.min(1000, 100 * 2 ** attempt) + Math.random() * 100,
      );
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
  from<K extends keyof D & string>(table: K) {
    return new QueryBuilder<D, K, RowOf<D, K>>(this, table, {});
  }
  auth = {
    signUp: async (input: { email: string; password: string; name: string }) => {
      const result = await this.request<any>('/auth/sign-up/email', 'POST', input, { auth: true });
      const session = result.token ? { user: result.user, token: result.token } : null;
      this.setSession(session, result.token ?? null);
      return session;
    },
    signIn: async (input: { email: string; password: string }) => {
      const result = await this.request<any>('/auth/sign-in/email', 'POST', input, { auth: true });
      if (result.twoFactorRedirect)
        throw new QBError('MFA_REQUIRED', 'Complete two-factor authentication');
      const session = { user: result.user, token: result.token };
      this.setSession(session, result.token ?? this.token);
      return session;
    },
    /** Requests a single-use magic link. The success body does not reveal whether the account exists. */
    signInWithMagicLink: async (
      email: string,
      options?: { callbackURL?: string; redirectTo?: string },
    ) => {
      const callbackURL = options?.callbackURL ?? options?.redirectTo;
      return this.request<{ status: boolean }>(
        '/auth/sign-in/magic-link',
        'POST',
        callbackURL ? { email, callbackURL } : { email },
        { auth: true },
      );
    },
    signOut: async () => {
      await this.request('/auth/sign-out', 'POST', {}, { auth: true });
      this.setSession(null, null);
    },
    passkey: {
      /** Runs the WebAuthn registration ceremony for the current application user. */
      enroll: async (opts?: { name?: string }) => {
        const result = await this.authClient().passkey.addPasskey(opts);
        if (result.error)
          throw new QBError(
            'PASSKEY_FAILED',
            result.error.message ?? 'Passkey registration failed',
            result.error.status,
          );
        return result.data as unknown;
      },
      list: async () => {
        const result = await (this.authClient() as any).$fetch('/passkey/list-user-passkeys');
        if (result.error)
          throw new QBError(
            'PASSKEY_FAILED',
            result.error.message ?? 'Unable to list passkeys',
            result.error.status,
          );
        return (result.data ?? []) as unknown[];
      },
      remove: async (id: string) => {
        const result = await (this.authClient() as any).$fetch('/passkey/delete-passkey', {
          method: 'POST',
          body: { id },
        });
        if (result.error)
          throw new QBError(
            'PASSKEY_FAILED',
            result.error.message ?? 'Unable to remove passkey',
            result.error.status,
          );
      },
      rename: async (id: string, name: string) => {
        const result = await (this.authClient() as any).$fetch('/passkey/update-passkey', {
          method: 'POST',
          body: { id, name },
        });
        if (result.error)
          throw new QBError(
            'PASSKEY_FAILED',
            result.error.message ?? 'Unable to rename passkey',
            result.error.status,
          );
      },
      /** Runs the WebAuthn authentication ceremony and adopts the returned session. */
      signIn: async () => {
        const result = await this.authClient().signIn.passkey();
        if (result.error)
          throw new QBError(
            'PASSKEY_FAILED',
            result.error.message ?? 'Passkey sign-in failed',
            result.error.status,
          );
        const payload = result.data as any;
        const session = payload?.user ? { user: payload.user, token: payload.token ?? null } : null;
        this.setSession(session, payload?.token ?? null);
        return session;
      },
    },
    twoFactor: {
      /** Returns the TOTP enrollment URI and one-time backup codes. */
      enable: async (password: string) => {
        const result = await this.request<any>(
          '/auth/two-factor/enable',
          'POST',
          { password },
          { auth: true },
        );
        return {
          totpURI: result.totpURI as string,
          backupCodes: (result.backupCodes ?? []) as string[],
        };
      },
      verify: async (code: string) => {
        await this.request('/auth/two-factor/verify-totp', 'POST', { code }, { auth: true });
      },
      disable: async (password: string) => {
        await this.request('/auth/two-factor/disable', 'POST', { password }, { auth: true });
      },
    },
    refreshSession: async (): Promise<Session | null> => {
      if (this.refreshPromise) return this.refreshPromise;
      this.refreshPromise = (async () => {
        try {
          const result = await this.request<any>('/auth/get-session', 'GET', undefined, {
            auth: true,
            refresh: false,
          });
          if (!result?.user) {
            this.setSession(null, null);
            return null;
          }
          const session = { user: result.user, expiresAt: result.session.expiresAt };
          this.setSession(session, this.token ?? result.session.token);
          return session;
        } catch (error) {
          if (
            error instanceof QBError &&
            (error.status === 401 ||
              error.code === 'ABORTED' ||
              error.code === 'IDENTITY_CHANGED' ||
              error.code === 'DISPOSED')
          ) {
            this.setSession(null, null);
            return null;
          }
          throw error;
        } finally {
          this.refreshPromise = null;
        }
      })();
      return this.refreshPromise;
    },
    resetPassword: async (email: string, redirectTo: string) =>
      this.request('/auth/request-password-reset', 'POST', { email, redirectTo }, { auth: true }),
    updatePassword: async (token: string, newPassword: string) =>
      this.request('/auth/reset-password', 'POST', { token, newPassword }, { auth: true }),
    sendVerification: async (email: string, callbackURL: string) =>
      this.request('/auth/send-verification-email', 'POST', { email, callbackURL }, { auth: true }),
    signInWithProvider: async (provider: 'google' | 'github', callbackURL: string) =>
      this.request<{ url: string }>(
        '/auth/sign-in/social',
        'POST',
        { provider, callbackURL },
        { auth: true },
      ),
  };
  rpc<K extends keyof R & string>(
    operation: K,
    args: R[K] extends { Args: infer A } ? A : never,
    options: RequestOptions = {},
  ) {
    return this.request<Result<R[K] extends { Returns: infer T } ? T : unknown>>(
      `/rpc/${encodeURIComponent(operation)}`,
      'POST',
      args,
      options,
    );
  }
  search(
    input: { collection: string; q: string; limit?: number; cursor?: string },
    options: RequestOptions = {},
  ) {
    return this.request<
      Result<{
        hits: {
          id: string;
          table: string;
          rank: number;
          snippet: string | null;
          row: Record<string, unknown>;
        }[];
        count: number | null;
        cursor: string | null;
      }>
    >('/search', 'POST', input, options);
  }
  channel(options: ChannelOptions) {
    const channel = new QBChannel(this, options, () => this.channels.delete(channel));
    this.channels.add(channel);
    return channel;
  }
  storage = {
    listBuckets: () => this.request<Result<any[]>>('/storage/buckets'),
    list: (bucket: string) =>
      this.request<Result<any[]>>(`/storage/buckets/${encodeURIComponent(bucket)}/objects`),
    upload: async (
      bucket: string,
      key: string,
      file: Blob,
      options: RequestOptions & { checksum?: string } = {},
    ) => {
      const intent = await this.request<Result<{ id: string }>>(
        `/storage/buckets/${encodeURIComponent(bucket)}/objects`,
        'POST',
        {
          key,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          ...(options.checksum ? { checksum: options.checksum } : {}),
        },
        options,
      );
      return this.request<Result<{ id: string; state: string }>>(
        `/storage/objects/${intent.data.id}/content`,
        'PUT',
        file,
        options,
      );
    },
    download: (id: string, options: RequestOptions = {}) =>
      this.request<Blob>(`/storage/objects/${encodeURIComponent(id)}/content`, 'GET', undefined, {
        ...options,
        raw: true,
      }),
    remove: (id: string, options: RequestOptions = {}) =>
      this.request<Result<{ deleted: boolean }>>(
        `/storage/objects/${encodeURIComponent(id)}`,
        'DELETE',
        undefined,
        options,
      ),
  };
  dispose() {
    this.disposed = true;
    for (const pending of this.pending) pending.abort();
    this.pending.clear();
    for (const channel of [...this.channels]) channel.unsubscribe();
    this.listeners.clear();
    this.token = null;
    this.session = null;
  }
}
export class QueryBuilder<D, K extends keyof D & string, R> implements PromiseLike<Result<R[]>> {
  constructor(
    private client: QBClient<D, any>,
    private table: K,
    private query: Query,
    private options: RequestOptions = {},
  ) {}
  private next(query: Partial<Query>) {
    return new QueryBuilder<D, K, R>(
      this.client,
      this.table,
      { ...this.query, ...query },
      this.options,
    );
  }
  select<C extends keyof RowOf<D, K> & string>(columns?: C[]) {
    return new QueryBuilder<D, K, Pick<RowOf<D, K>, C>>(
      this.client,
      this.table,
      { ...this.query, columns },
      this.options,
    );
  }
  filter(column: keyof RowOf<D, K> & string, op: Filter['op'], value?: Filter['value']) {
    return this.next({ filters: [...(this.query.filters ?? []), { column, op, value }] });
  }
  eq<C extends keyof RowOf<D, K> & string>(column: C, value: RowOf<D, K>[C]) {
    return this.filter(column, 'eq', value as Filter['value']);
  }
  order(column: keyof RowOf<D, K> & string, direction: 'asc' | 'desc' = 'asc') {
    return this.next({ order: [...(this.query.order ?? []), { column, direction }] });
  }
  limit(limit: number) {
    return this.next({ limit });
  }
  cursor(cursor: string) {
    return this.next({ cursor });
  }
  include<N extends keyof RelationsOf<D, K> & string>(
    relations: { name: N; columns?: string[]; limit?: number }[],
  ) {
    return new QueryBuilder<D, K, R & Pick<RelationsOf<D, K>, N>>(
      this.client,
      this.table,
      { ...this.query, relations },
      this.options,
    );
  }
  count() {
    return this.next({ count: true });
  }
  groupBy(columns: (keyof RowOf<D, K> & string)[]) {
    return this.next({ groupBy: columns as string[] });
  }
  aggregate(fn: AggregateExpr['fn'], column?: keyof RowOf<D, K> & string, alias?: string) {
    const generatedAlias = alias ?? `${fn}_${String(column ?? 'star')}`;
    return this.next({
      aggregates: [
        ...(this.query.aggregates ?? []),
        { fn, column: column as string | undefined, alias: generatedAlias },
      ],
    });
  }
  having(alias: string, op: HavingClause['op'], value: HavingClause['value']) {
    return this.next({
      having: [...(this.query.having ?? []), { alias, op, value }],
    });
  }
  abortSignal(signal: AbortSignal) {
    return new QueryBuilder<D, K, R>(this.client, this.table, this.query, {
      ...this.options,
      signal,
    });
  }
  execute() {
    return this.client.request<Result<R[]>>(
      `/data/${encodeURIComponent(this.table)}/query`,
      'POST',
      this.query,
      { ...this.options, safe: true },
    );
  }
  then<A = Result<R[]>, B = never>(
    fulfilled?: ((result: Result<R[]>) => A | PromiseLike<A>) | null,
    rejected?: ((reason: any) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(fulfilled, rejected);
  }
  insert(row: InsertOf<D, K> | InsertOf<D, K>[], options: RequestOptions = {}) {
    return this.client.request<Result<RowOf<D, K>[]>>(
      `/data/${encodeURIComponent(this.table)}`,
      'POST',
      row,
      options,
    );
  }
  upsert(row: InsertOf<D, K> | InsertOf<D, K>[], options: RequestOptions = {}) {
    return this.client.request<Result<RowOf<D, K>[]>>(
      `/data/${encodeURIComponent(this.table)}/upsert`,
      'POST',
      row,
      options,
    );
  }
  update(key: string | number | unknown[], row: UpdateOf<D, K>, options: RequestOptions = {}) {
    return this.client.request<Result<RowOf<D, K>[]>>(
      `/data/${encodeURIComponent(this.table)}/${encodeURIComponent(encodeKey(key))}`,
      'PATCH',
      row,
      options,
    );
  }
  delete(key: string | number | unknown[], options: RequestOptions = {}) {
    return this.client.request<Result<RowOf<D, K>[]>>(
      `/data/${encodeURIComponent(this.table)}/${encodeURIComponent(encodeKey(key))}`,
      'DELETE',
      undefined,
      options,
    );
  }
}
function encodeKey(key: string | number | unknown[]) {
  if (!Array.isArray(key)) return String(key);
  const bytes = new TextEncoder().encode(JSON.stringify(key));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export class QBChannel {
  private socket: WebSocket | null = null;
  private stopped = true;
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private cursor?: string;
  private seen = new Set<string>();
  constructor(
    private client: QBClient<any, any>,
    private options: ChannelOptions,
    private onDispose: () => void,
  ) {
    this.cursor = options.cursor;
  }
  subscribe() {
    if (!this.stopped) return this;
    this.stopped = false;
    this.connect();
    return this;
  }
  private connect() {
    if (this.stopped) return;
    this.options.onStatus?.('connecting');
    const socket = new WebSocket(this.client.baseURL.replace(/^http/, 'ws') + '/realtime');
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      socket.send(
        JSON.stringify({
          type: 'join',
          table: this.options.table,
          publishableKey: this.client.options.publishableKey,
          token: this.client.getToken(),
          cursor: this.cursor,
        }),
      );
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'heartbeat' }));
      }, 25000);
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket || this.stopped) return;
      let event: any;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type === 'joined') {
        this.retry = 0;
        this.options.onStatus?.('connected');
      } else if (event.type === 'cursor') this.cursor = event.cursor;
      else if (event.type === 'database') {
        if (this.seen.has(event.eventId)) return;
        this.seen.add(event.eventId);
        if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
        this.options.onEvent(event);
      } else if (event.code === 'RESYNC_REQUIRED') {
        this.cursor = undefined;
        this.options.onResync?.();
      } else if (event.type === 'error')
        this.options.onStatus?.(event.code === 'UNAUTHORIZED' ? 'unauthorized' : 'error');
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.stopped) return;
      if (event.code === 4001) {
        this.options.onStatus?.('unauthorized');
        return;
      }
      this.options.onStatus?.('reconnecting');
      this.timer = setTimeout(
        () => this.connect(),
        Math.min(30000, 500 * 2 ** this.retry++) + Math.random() * 300,
      );
    };
  }
  reauthenticate() {
    if (this.stopped) return;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.cursor = undefined;
    this.seen.clear();
    this.connect();
  }
  unsubscribe() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    this.socket = null;
    this.options.onStatus?.('disconnected');
    this.onDispose();
  }
}
