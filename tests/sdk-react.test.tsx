import { test, expect } from 'bun:test';
import React, { StrictMode } from 'react';
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient } from '@tanstack/react-query';
import { createClient, QBError } from '@qb-flex/client';
import { QBProvider, useQBAuth, useQBClient, useQBQuery, useQBRealtime } from '@qb-flex/react';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function fakeClient(project = 'p') {
  let user: any = null;
  let token = '';
  let refreshes = 0;
  const fetcher = (async (input: any, init: any) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/sign-in/email')) {
      const body = JSON.parse(init.body);
      user = { id: body.email, email: body.email, name: body.email };
      token = 'opaque-' + body.email;
      return Response.json({ user, token });
    }
    if (path.endsWith('/auth/sign-out')) {
      user = null;
      token = '';
      return Response.json({ success: true });
    }
    if (path.endsWith('/auth/get-session')) {
      refreshes++;
      await Bun.sleep(5);
      return Response.json(user ? { user, session: { token, expiresAt: '2099-01-01' } } : null);
    }
    return Response.json({ data: [{ owner: user?.id ?? null }], meta: { requestId: 'test' } });
  }) as typeof fetch;
  return {
    client: createClient({
      url: 'http://localhost:7612',
      projectId: project,
      publishableKey: 'test',
      fetch: fetcher,
    }),
    get refreshes() {
      return refreshes;
    },
  };
}
test('provider boundary is actionable and SSR uses request-local anonymous state without browser globals', () => {
  const result = Bun.spawnSync(['bun', 'tests/fixtures-ssr.tsx'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  const state = JSON.parse(result.stdout.toString());
  expect(state.boundary).toBe(true);
  expect(state.first).toContain('anonymous');
  expect(state.second).toContain('anonymous');
  expect(state.requests).toBe(0);
  expect(state.browserGlobals).toBe(false);
});

test('shared auth updates, single-flight refresh, explicit identity cache keys and cache cancellation', async () => {
  const source = fakeClient(),
    cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let snapshots: any[] = [];
  function Child() {
    const auth = useQBAuth();
    const query = useQBQuery({
      queryKey: ['tasks'],
      queryFn: (client, signal) => client.from('tasks').abortSignal(signal).execute(),
    });
    snapshots.push({ id: auth.user?.id, value: query.data });
    return <span>{auth.user?.id ?? 'anonymous'}</span>;
  }
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <StrictMode>
        <QBProvider client={source.client} queryClient={cache}>
          <Child />
          <Child />
        </QBProvider>
      </StrictMode>,
    );
    await Bun.sleep(20);
  });
  expect(source.refreshes).toBe(1);
  await act(async () => {
    await source.client.auth.signIn({ email: 'alice', password: 'password' });
    await Bun.sleep(15);
  });
  expect(tree.root.findAllByType('span').every((node) => node.children[0] === 'alice')).toBe(true);
  expect(
    cache
      .getQueryCache()
      .getAll()
      .every((q) => String(q.queryKey[2]).includes('alice')),
  ).toBe(true);
  expect(
    cache
      .getQueryCache()
      .getAll()
      .some((q) => JSON.stringify(q.queryKey).includes('opaque-')),
  ).toBe(false);
  const controller = new AbortController();
  let cancelled = false;
  cache.setQueryDefaults(['qb', source.client.scope], {
    queryFn: ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          cancelled = true;
          reject(new Error('cancelled'));
        });
      }),
  });
  void cache
    .fetchQuery({ queryKey: ['qb', source.client.scope, 'alice:1', 'pending'] })
    .catch(() => {});
  await act(async () => {
    await source.client.auth.signOut();
    await Bun.sleep(15);
  });
  expect(cancelled).toBe(true);
  expect(
    cache
      .getQueryCache()
      .getAll()
      .every((q) => String(q.queryKey[2]).includes('anonymous')),
  ).toBe(true);
  await act(async () => tree.unmount());
  source.client.dispose();
});
test('Strict Mode and unmount dispose subscriptions without duplicate sockets', async () => {
  const source = fakeClient();
  const Original = globalThis.WebSocket;
  const sockets: any[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    onopen: any;
    onclose: any;
    onmessage: any;
    closed = false;
    constructor() {
      sockets.push(this);
    }
    send() {}
    close() {
      this.closed = true;
      this.onclose?.({ code: 1000 });
    }
  }
  (globalThis as any).WebSocket = Socket;
  function Child() {
    useQBRealtime({ table: 'tasks', onEvent: () => {} });
    return null;
  }
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(
        <StrictMode>
          <QBProvider client={source.client}>
            <Child />
          </QBProvider>
        </StrictMode>,
      );
      await Bun.sleep(10);
    });
    expect(sockets.filter((s) => !s.closed).length).toBe(1);
    await act(async () => tree.unmount());
    expect(sockets.every((s) => s.closed)).toBe(true);
    await source.client.auth.signIn({ email: 'other', password: 'password' });
    expect(sockets.filter((s) => !s.closed).length).toBe(0);
  } finally {
    globalThis.WebSocket = Original;
    source.client.dispose();
  }
});
test('client cancellation, timeouts and disposal produce normalized errors', async () => {
  const source = createClient({
    url: 'http://localhost:7612',
    projectId: 'p',
    publishableKey: 'k',
    timeoutMs: 5,
    fetch: async (_, init) =>
      new Promise((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)),
      ),
  });
  try {
    await source.from('tasks');
    throw new Error('Expected timeout');
  } catch (error) {
    expect(error instanceof QBError).toBe(true);
    expect((error as QBError).code).toBe('TIMEOUT');
  }
  source.dispose();
  expect(source.from('tasks').execute()).rejects.toMatchObject({ code: 'DISPOSED' });
});
