// packages/contracts/src/index.ts
class QBError extends Error {
  code;
  status;
  retryable;
  details;
  constructor(code, message, status = 400, retryable = false, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
    this.name = "QBError";
  }
}

// packages/sdk-js/src/index.ts
function createClient(options) {
  return new QBClient(options);
}

class QBClient {
  options;
  baseURL;
  scope;
  token = null;
  session = null;
  listeners = new Set;
  refreshPromise = null;
  channels = new Set;
  disposed = false;
  epoch = 0;
  pending = new Set;
  constructor(options) {
    this.options = options;
    let url;
    try {
      url = new URL(options.url);
    } catch {
      throw new QBError("CONFIG", "Use an absolute HTTP(S) API URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new QBError("CONFIG", "Use an HTTP(S) API URL without credentials, query parameters or fragments");
    this.baseURL = `${options.url.replace(/\/$/, "")}/v1/projects/${encodeURIComponent(options.projectId)}/branches/${encodeURIComponent(options.branch ?? "primary")}`;
    this.scope = `${options.url}/${options.projectId}/${options.branch ?? "primary"}`;
  }
  getSession() {
    return this.session;
  }
  getIdentityVersion() {
    return this.epoch;
  }
  getToken() {
    return this.token;
  }
  onAuthStateChange(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setSession(session, token) {
    const before = this.session?.user.id;
    this.session = session;
    if (token !== undefined)
      this.token = token;
    if (before !== session?.user.id) {
      this.epoch++;
      for (const pending of this.pending)
        pending.abort(new QBError("IDENTITY_CHANGED", "Application identity changed", 499));
      for (const channel of this.channels)
        channel.reauthenticate();
    }
    for (const listener of this.listeners)
      listener(session);
  }
  async request(path, method = "GET", body, options = {}) {
    if (this.disposed)
      throw new QBError("DISPOSED", "Client has been disposed");
    const fetcher = this.options.fetch ?? globalThis.fetch;
    let attempt = 0;
    let currentSignal, currentTimeout;
    const cancellation = new AbortController;
    this.pending.add(cancellation);
    try {
      while (true) {
        const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15000);
        const signal = AbortSignal.any([
          timeout,
          cancellation.signal,
          ...options.signal ? [options.signal] : []
        ]);
        currentSignal = signal;
        currentTimeout = timeout;
        const headers = {
          "x-qb-key": this.options.publishableKey,
          "x-request-id": crypto.randomUUID()
        };
        if (this.token)
          headers.authorization = `Bearer ${this.token}`;
        if (options.idempotencyKey)
          headers["idempotency-key"] = options.idempotencyKey;
        if (options.revision !== undefined)
          headers["if-match"] = String(options.revision);
        const binary = typeof Blob !== "undefined" && body instanceof Blob || body instanceof Uint8Array;
        if (body !== undefined && !binary)
          headers["content-type"] = "application/json";
        let response;
        try {
          response = await fetcher(this.baseURL + path, {
            method,
            headers,
            signal,
            credentials: this.options.credentials ?? "include",
            body: body === undefined ? undefined : binary ? body : JSON.stringify(body)
          });
        } catch (error) {
          if (signal.aborted)
            throw new QBError(timeout.aborted ? "TIMEOUT" : "ABORTED", timeout.aborted ? "Request timed out" : "Request was cancelled", timeout.aborted ? 408 : 499, timeout.aborted);
          if ((method === "GET" || options.safe || options.idempotencyKey) && attempt++ < 2) {
            await this.delay(attempt, signal);
            continue;
          }
          throw new QBError("NETWORK", "Unable to reach QB Flex", 0, true);
        }
        const rotated = response.headers.get("set-auth-token");
        if (rotated)
          this.token = rotated;
        if (response.ok) {
          if (options.raw)
            return await response.blob();
          if (response.status === 204)
            return;
          return await response.json();
        }
        if (response.status === 401 && !options.auth && options.refresh !== false && this.token && attempt++ === 0) {
          if (await this.auth.refreshSession())
            continue;
        }
        const value = await response.json().catch(() => null);
        const error = new QBError(value?.error?.code ?? value?.code ?? "REQUEST_FAILED", value?.error?.message ?? value?.message ?? `Request failed (${response.status})`, response.status, value?.error?.retryable ?? false, value?.error?.details);
        if (error.retryable && (method === "GET" || options.safe || options.idempotencyKey) && attempt++ < 2) {
          await this.delay(attempt, signal);
          continue;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof QBError)
        throw error;
      if (currentSignal?.aborted)
        throw new QBError(currentTimeout?.aborted ? "TIMEOUT" : "ABORTED", currentTimeout?.aborted ? "Request timed out" : "Request was cancelled", currentTimeout?.aborted ? 408 : 499, !!currentTimeout?.aborted);
      throw new QBError("PROTOCOL", "QB Flex returned an invalid response", 502);
    } finally {
      this.pending.delete(cancellation);
    }
  }
  delay(attempt, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, Math.min(1000, 100 * 2 ** attempt) + Math.random() * 100);
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      if (signal?.aborted)
        abort();
      else
        signal?.addEventListener("abort", abort, { once: true });
    });
  }
  from(table) {
    return new QueryBuilder(this, table, {});
  }
  auth = {
    signUp: async (input) => {
      const result = await this.request("/auth/sign-up/email", "POST", input, { auth: true });
      const session = result.token ? { user: result.user, token: result.token } : null;
      this.setSession(session, result.token ?? null);
      return session;
    },
    signIn: async (input) => {
      const result = await this.request("/auth/sign-in/email", "POST", input, { auth: true });
      if (result.twoFactorRedirect)
        throw new QBError("MFA_REQUIRED", "Complete two-factor authentication");
      const session = { user: result.user, token: result.token };
      this.setSession(session, result.token ?? this.token);
      return session;
    },
    signOut: async () => {
      await this.request("/auth/sign-out", "POST", {}, { auth: true });
      this.setSession(null, null);
    },
    refreshSession: async () => {
      if (this.refreshPromise)
        return this.refreshPromise;
      this.refreshPromise = (async () => {
        try {
          const result = await this.request("/auth/get-session", "GET", undefined, {
            auth: true,
            refresh: false
          });
          if (!result?.user) {
            this.setSession(null, null);
            return null;
          }
          const session = { user: result.user, expiresAt: result.session.expiresAt };
          this.setSession(session, this.token ?? result.session.token);
          return session;
        } catch (error) {
          if (error instanceof QBError && error.status === 401) {
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
    resetPassword: async (email, redirectTo) => this.request("/auth/request-password-reset", "POST", { email, redirectTo }, { auth: true }),
    updatePassword: async (token, newPassword) => this.request("/auth/reset-password", "POST", { token, newPassword }, { auth: true }),
    sendVerification: async (email, callbackURL) => this.request("/auth/send-verification-email", "POST", { email, callbackURL }, { auth: true }),
    signInWithProvider: async (provider, callbackURL) => this.request("/auth/sign-in/social", "POST", { provider, callbackURL }, { auth: true })
  };
  rpc(operation, args, options = {}) {
    return this.request(`/rpc/${encodeURIComponent(operation)}`, "POST", args, options);
  }
  channel(options) {
    const channel = new QBChannel(this, options, () => this.channels.delete(channel));
    this.channels.add(channel);
    return channel;
  }
  storage = {
    listBuckets: () => this.request("/storage/buckets"),
    list: (bucket) => this.request(`/storage/buckets/${encodeURIComponent(bucket)}/objects`),
    upload: async (bucket, key, file, options = {}) => {
      const intent = await this.request(`/storage/buckets/${encodeURIComponent(bucket)}/objects`, "POST", { key, size: file.size, mime: file.type || "application/octet-stream" }, options);
      return this.request(`/storage/objects/${intent.data.id}/content`, "PUT", file, options);
    },
    download: (id, options = {}) => this.request(`/storage/objects/${encodeURIComponent(id)}/content`, "GET", undefined, {
      ...options,
      raw: true
    }),
    remove: (id, options = {}) => this.request(`/storage/objects/${encodeURIComponent(id)}`, "DELETE", undefined, options)
  };
  dispose() {
    this.disposed = true;
    for (const pending of this.pending)
      pending.abort();
    this.pending.clear();
    for (const channel of [...this.channels])
      channel.unsubscribe();
    this.listeners.clear();
    this.token = null;
    this.session = null;
  }
}

class QueryBuilder {
  client;
  table;
  query;
  options;
  constructor(client, table, query, options = {}) {
    this.client = client;
    this.table = table;
    this.query = query;
    this.options = options;
  }
  next(query) {
    return new QueryBuilder(this.client, this.table, { ...this.query, ...query }, this.options);
  }
  select(columns) {
    return new QueryBuilder(this.client, this.table, { ...this.query, columns }, this.options);
  }
  filter(column, op, value) {
    return this.next({ filters: [...this.query.filters ?? [], { column, op, value }] });
  }
  eq(column, value) {
    return this.filter(column, "eq", value);
  }
  order(column, direction = "asc") {
    return this.next({ order: [...this.query.order ?? [], { column, direction }] });
  }
  limit(limit) {
    return this.next({ limit });
  }
  cursor(cursor) {
    return this.next({ cursor });
  }
  include(relations) {
    return new QueryBuilder(this.client, this.table, { ...this.query, relations }, this.options);
  }
  count() {
    return this.next({ count: true });
  }
  abortSignal(signal) {
    return new QueryBuilder(this.client, this.table, this.query, {
      ...this.options,
      signal
    });
  }
  execute() {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/query`, "POST", this.query, { ...this.options, safe: true });
  }
  then(fulfilled, rejected) {
    return this.execute().then(fulfilled, rejected);
  }
  insert(row, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}`, "POST", row, options);
  }
  upsert(row, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/upsert`, "POST", row, options);
  }
  update(key, row, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/${encodeURIComponent(encodeKey(key))}`, "PATCH", row, options);
  }
  delete(key, options = {}) {
    return this.client.request(`/data/${encodeURIComponent(this.table)}/${encodeURIComponent(encodeKey(key))}`, "DELETE", undefined, options);
  }
}
function encodeKey(key) {
  if (!Array.isArray(key))
    return String(key);
  const bytes = new TextEncoder().encode(JSON.stringify(key));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

class QBChannel {
  client;
  options;
  onDispose;
  socket = null;
  stopped = true;
  retry = 0;
  timer;
  heartbeat;
  cursor;
  seen = new Set;
  constructor(client, options, onDispose) {
    this.client = client;
    this.options = options;
    this.onDispose = onDispose;
    this.cursor = options.cursor;
  }
  subscribe() {
    if (!this.stopped)
      return this;
    this.stopped = false;
    this.connect();
    return this;
  }
  connect() {
    if (this.stopped)
      return;
    this.options.onStatus?.("connecting");
    const socket = new WebSocket(this.client.baseURL.replace(/^http/, "ws") + "/realtime");
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket)
        return;
      socket.send(JSON.stringify({
        type: "join",
        table: this.options.table,
        publishableKey: this.client.options.publishableKey,
        token: this.client.getToken(),
        cursor: this.cursor
      }));
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "heartbeat" }));
      }, 25000);
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket || this.stopped)
        return;
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type === "joined") {
        this.retry = 0;
        this.options.onStatus?.("connected");
      } else if (event.type === "cursor")
        this.cursor = event.cursor;
      else if (event.type === "database") {
        if (this.seen.has(event.eventId))
          return;
        this.seen.add(event.eventId);
        if (this.seen.size > 1000)
          this.seen.delete(this.seen.values().next().value);
        this.options.onEvent(event);
      } else if (event.code === "RESYNC_REQUIRED") {
        this.cursor = undefined;
        this.options.onResync?.();
      } else if (event.type === "error")
        this.options.onStatus?.(event.code === "UNAUTHORIZED" ? "unauthorized" : "error");
    };
    socket.onclose = (event) => {
      if (this.socket !== socket)
        return;
      if (this.heartbeat)
        clearInterval(this.heartbeat);
      if (this.stopped)
        return;
      if (event.code === 4001) {
        this.options.onStatus?.("unauthorized");
        return;
      }
      this.options.onStatus?.("reconnecting");
      this.timer = setTimeout(() => this.connect(), Math.min(30000, 500 * 2 ** this.retry++) + Math.random() * 300);
    };
  }
  reauthenticate() {
    if (this.stopped)
      return;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    if (this.timer)
      clearTimeout(this.timer);
    if (this.heartbeat)
      clearInterval(this.heartbeat);
    this.cursor = undefined;
    this.seen.clear();
    this.connect();
  }
  unsubscribe() {
    this.stopped = true;
    if (this.timer)
      clearTimeout(this.timer);
    if (this.heartbeat)
      clearInterval(this.heartbeat);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    this.socket = null;
    this.options.onStatus?.("disconnected");
    this.onDispose();
  }
}
export {
  QBChannel,
  QBClient,
  QBError,
  QueryBuilder,
  createClient
};

//# debugId=96C3CFBF621FA6FB64756E2164756E21
