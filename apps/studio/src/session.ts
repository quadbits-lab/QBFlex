import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { raw } from './api';

type Request = typeof raw;
export type PlatformSession = {
  user: { id: string; name: string; email: string; image?: string | null };
  session: { id: string; expiresAt: string };
};

function parseSession(value: unknown): PlatformSession | null {
  if (value === null) return null;
  const session = value as PlatformSession | undefined;
  if (
    typeof session?.user?.id !== 'string' ||
    !session.user.id ||
    typeof session.user.name !== 'string' ||
    typeof session.user.email !== 'string' ||
    typeof session.session?.id !== 'string' ||
    !session.session.id ||
    typeof session.session.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(session.session.expiresAt))
  )
    throw new Error('The API returned an invalid session. Check the API connection and retry.');
  if (Date.parse(session.session.expiresAt) <= Date.now()) return null;
  return session;
}

export const platformSessionOptions = (request: Request = raw) =>
  queryOptions({
    queryKey: ['platform-session'],
    queryFn: async ({ signal }) =>
      parseSession(
        await request('/platform/auth/get-session', 'GET', undefined, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          cache: 'no-store',
        }),
      ),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

const setupOptions = (request: Request = raw) =>
  queryOptions({
    queryKey: ['setup'],
    queryFn: async ({ signal }) => {
      const value = await request('/setup', 'GET', undefined, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        cache: 'no-store',
      });
      if (typeof value?.data?.required !== 'boolean')
        throw new Error('The API returned an invalid setup state.');
      return value as { data: { required: boolean } };
    },
    retry: false,
    staleTime: 0,
  });

/** Only local Studio paths are accepted; auth/error destinations would cause redirect loops. */
export function studioReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\u0000-\u0020\u007f]/.test(value))
    return '/overview';
  try {
    const target = new URL(value, 'https://studio.invalid');
    const pathname = decodeURIComponent(target.pathname);
    if (
      /[%\\\u0000-\u0020\u007f]/.test(pathname) ||
      pathname.startsWith('//') ||
      target.origin !== 'https://studio.invalid' ||
      /^\/(?:sign-in|setup|error)(?:\/|$)/i.test(pathname)
    )
      return '/overview';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/overview';
  }
}

export async function guardStudioRoute(
  client: QueryClient,
  page: 'console' | 'sign-in' | 'setup',
  returnTo?: unknown,
  request: Request = raw,
) {
  const [setup, session] = await Promise.all([
    client.fetchQuery(setupOptions(request)),
    client.fetchQuery(platformSessionOptions(request)),
  ]);
  if (setup.data.required) {
    if (page !== 'setup') throw redirect({ to: '/setup', replace: true });
  } else if (!session) {
    if (page !== 'sign-in')
      throw redirect({
        to: '/sign-in',
        search: { redirect: studioReturnTo(returnTo) },
        replace: true,
      });
  } else if (page !== 'console') {
    throw redirect({ to: studioReturnTo(returnTo), replace: true });
  }
  return { platformSession: session };
}

/** A successful ceremony is insufficient until the browser sends back its HttpOnly cookie. */
export async function confirmPlatformSignIn(client: QueryClient, request: Request = raw) {
  await client.cancelQueries();
  client.removeQueries({
    predicate: (query) => !['platform-session', 'setup'].includes(String(query.queryKey[0])),
  });
  const session = await client.fetchQuery(platformSessionOptions(request));
  if (!session)
    throw new Error(
      'The browser could not establish a session. Allow cookies and use matching Studio/API hostnames, then sign in again.',
    );
  return session;
}
