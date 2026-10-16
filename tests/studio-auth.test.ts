import { test, expect } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import { studioAPIURL } from '../apps/studio/src/api-url';
import {
  guardStudioRoute,
  confirmPlatformSignIn,
  platformSessionOptions,
  studioReturnTo,
} from '../apps/studio/src/session';

const session = {
  user: { id: 'owner', name: 'Owner', email: 'owner@example.com' },
  session: { id: 'session', expiresAt: new Date(Date.now() + 3600000).toISOString() },
};
const request =
  (value: unknown, required = false): Parameters<typeof guardStudioRoute>[3] =>
  async (path) =>
    path === '/setup' ? { data: { required } } : value;
async function destination(action: Promise<unknown>) {
  try {
    await action;
    return null;
  } catch (error) {
    if (!isRedirect(error)) throw error;
    return error.options;
  }
}

test('local Studio/API aliases share a cookie host while configured remote hosts and ports stay intact', () => {
  expect(studioAPIURL('http://localhost:7612', '127.0.0.1')).toBe('http://127.0.0.1:7612');
  expect(studioAPIURL('http://127.0.0.1:7622/api/', 'localhost')).toBe('http://localhost:7622/api');
  expect(studioAPIURL('https://api.example.com', 'localhost')).toBe('https://api.example.com');
  expect(studioAPIURL('http://localhost:7612', 'studio.example.com')).toBe('http://localhost:7612');
  expect(studioAPIURL('http://localhost:7612')).toBe('http://localhost:7612');
});

test('return destinations reject external URLs, auth loops and encoded bypasses', () => {
  for (const value of [
    undefined,
    {},
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/sign-in?redirect=/database',
    '/setup',
    '/SIGN-IN',
    '/error/500',
    '/%73ign-in',
    '/%2f%2fevil.example',
    '/%255csign-in',
    '/%00database',
    '/%not-valid',
  ])
    expect(studioReturnTo(value)).toBe('/overview');
  expect(studioReturnTo('/database?tab=rows#grid')).toBe('/database?tab=rows#grid');
  expect(studioReturnTo('/../sign-in')).toBe('/overview');
});

test('route guards use current session state, preserve a local return path and require setup first', async () => {
  const client = new QueryClient();
  try {
    client.setQueryData(['platform-session'], session);
    const anonymous = await destination(
      guardStudioRoute(client, 'console', '/database?tab=rows', request(null)),
    );
    expect(anonymous?.to).toBe('/sign-in');
    expect(JSON.stringify(anonymous?.search)).toBe(
      JSON.stringify({ redirect: '/database?tab=rows' }),
    );
    expect(
      (await destination(guardStudioRoute(client, 'console', '/overview', request(null, true))))
        ?.to,
    ).toBe('/setup');
    expect(
      (await guardStudioRoute(client, 'setup', undefined, request(null, true))).platformSession,
    ).toBeNull();
    expect(
      (await destination(guardStudioRoute(client, 'setup', undefined, request(null))))?.to,
    ).toBe('/sign-in');
    expect(
      (await destination(guardStudioRoute(client, 'sign-in', '/database', request(session))))?.to,
    ).toBe('/database');
    expect(
      (await guardStudioRoute(client, 'console', '/overview', request(session))).platformSession
        ?.user.id,
    ).toBe('owner');
  } finally {
    client.clear();
  }
});

test('network errors and malformed session/setup responses fail closed without a sign-in redirect', async () => {
  const client = new QueryClient();
  try {
    client.setQueryData(['platform-session'], session);
    await expect(
      guardStudioRoute(client, 'console', '/database', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    for (const value of [
      {},
      { user: session.user },
      { ...session, session: { id: 's', expiresAt: 'invalid' } },
    ])
      await expect(
        guardStudioRoute(client, 'console', '/overview', request(value)),
      ).rejects.toThrow('invalid session');
    await expect(
      guardStudioRoute(client, 'console', '/overview', async (path) =>
        path === '/setup' ? {} : session,
      ),
    ).rejects.toThrow('invalid setup');
    const expired = {
      ...session,
      session: { ...session.session, expiresAt: '2000-01-01T00:00:00Z' },
    };
    expect(
      (await destination(guardStudioRoute(client, 'console', '/overview', request(expired))))?.to,
    ).toBe('/sign-in');
  } finally {
    client.clear();
  }
});

test('sign-in requires a verified cookie session and discards previous identity data', async () => {
  const client = new QueryClient();
  try {
    client.setQueryData(['platform-session'], session);
    client.setQueryData(['projects'], ['previous-user-private-project']);
    await expect(confirmPlatformSignIn(client, request(null))).rejects.toThrow(
      'could not establish a session',
    );
    expect(client.getQueryData(['projects'])).toBeUndefined();
    expect(await confirmPlatformSignIn(client, request(session))).toEqual(session);
    expect(client.getQueryData<typeof session>(['platform-session'])).toEqual(session);
  } finally {
    client.clear();
  }
});

test('an anonymous request started before sign-in cannot overwrite the newly verified session', async () => {
  const client = new QueryClient();
  let finish!: (value: null) => void;
  let signal: AbortSignal | undefined;
  const observer = new QueryObserver(
    client,
    platformSessionOptions(async (_path, _method, _body, options) => {
      signal = options?.signal;
      return new Promise<null>((resolve) => {
        finish = resolve;
      });
    }),
  );
  const stop = observer.subscribe(() => {});
  try {
    expect(signal?.aborted).toBe(false);
    await confirmPlatformSignIn(client, request(session));
    expect(signal?.aborted).toBe(true);
    finish(null);
    await Bun.sleep(0);
    expect(client.getQueryData<typeof session>(['platform-session'])).toEqual(session);
  } finally {
    stop();
    client.clear();
  }
});
