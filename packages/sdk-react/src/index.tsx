import {
  createContext,
  useContext,
  useState,
  useEffect,
  useSyncExternalStore,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { QBClient, type Session, type ChannelOptions } from '@qb-flex/client';
export interface QBProviderProps {
  client: QBClient<any, any>;
  queryClient?: QueryClient;
  children: ReactNode;
}
type AuthActions = {
  isLoading: boolean;
  error: Error | null;
  perform: <T>(operation: () => Promise<T>) => Promise<T>;
};
const Context = createContext<{ client: QBClient<any, any>; auth: AuthActions } | null>(null);
/** Supply a stable client created outside rendering, or once with useState. */
export function QBProvider({ client, queryClient, children }: QBProviderProps) {
  const [ownedCache] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } }),
  );
  const cache = queryClient ?? ownedCache;
  const active = useRef(true),
    pending = useRef(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<Error | null>(null);
  const perform = useCallback(async <T,>(operation: () => Promise<T>) => {
    pending.current++;
    if (active.current) {
      setLoading(true);
      setError(null);
    }
    try {
      return await operation();
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error : new Error('Authentication failed'));
      throw error;
    } finally {
      pending.current--;
      if (active.current) setLoading(pending.current > 0);
    }
  }, []);
  const value = useMemo(
    () => ({ client, auth: { isLoading: loading, error, perform } }),
    [client, loading, error, perform],
  );
  useEffect(() => {
    active.current = true;
    let previous = client.getSession()?.user.id ?? null;
    const remove = client.onAuthStateChange((session) => {
      const current = session?.user.id ?? null;
      if (previous !== current) {
        previous = current;
        const filter = {
          predicate: (query: any) =>
            query.queryKey[0] === 'qb' && query.queryKey[1] === client.scope,
        };
        void cache.cancelQueries(filter);
        cache.removeQueries(filter);
      }
    });
    void perform(() => client.auth.refreshSession()).catch(() => {});
    return () => {
      active.current = false;
      remove();
    };
  }, [client, cache, perform]);
  return (
    <Context.Provider value={value}>
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    </Context.Provider>
  );
}
export function useQBClient<D = any, R = any>(): QBClient<D, R> {
  const context = useContext(Context);
  if (!context)
    throw new Error('QB Flex hooks require <QBProvider client={client}> above this component.');
  return context.client;
}
const serverSession = () => null;
export function useQBAuth() {
  const client = useQBClient();
  const subscribe = useCallback(
    (listener: () => void) => client.onAuthStateChange(() => listener()),
    [client],
  );
  const getSnapshot = useCallback(() => client.getSession(), [client]);
  const session = useSyncExternalStore(subscribe, getSnapshot, serverSession);
  const state = useContext(Context)!.auth;
  const action = state.perform;
  return {
    session,
    user: session?.user ?? null,
    isLoading: state.isLoading,
    error: state.error,
    signIn: (input: Parameters<typeof client.auth.signIn>[0]) =>
      action(() => client.auth.signIn(input)),
    signUp: (input: Parameters<typeof client.auth.signUp>[0]) =>
      action(() => client.auth.signUp(input)),
    signOut: () => action(() => client.auth.signOut()),
    refresh: () => action(() => client.auth.refreshSession()),
  };
}
function useIdentity() {
  const client = useQBClient();
  const subscribe = useCallback(
    (listener: () => void) => client.onAuthStateChange(() => listener()),
    [client],
  );
  return useSyncExternalStore(
    subscribe,
    () => `${client.getSession()?.user.id ?? 'anonymous'}:${client.getIdentityVersion()}`,
    () => 'anonymous:0',
  );
}
export function useQBQuery<T, D = any>(options: {
  queryKey: QueryKey;
  queryFn: (client: QBClient<D>, signal: AbortSignal) => PromiseLike<T>;
  enabled?: boolean;
}) {
  const client = useQBClient<D>();
  const identity = useIdentity();
  return useQuery({
    queryKey: ['qb', client.scope, identity, ...options.queryKey],
    enabled: options.enabled,
    queryFn: async ({ signal }) => {
      const started = client.getIdentityVersion();
      const data = await options.queryFn(client, signal);
      if (signal.aborted || started !== client.getIdentityVersion())
        throw new Error('QB Flex identity changed during request');
      return data;
    },
  });
}
export function useQBMutation<T, V, D = any>(options: {
  mutationFn: (client: QBClient<D>, variables: V) => Promise<T>;
  invalidate?: QueryKey[];
}) {
  const client = useQBClient<D>();
  const identity = useIdentity();
  const cache = useQueryClient();
  return useMutation({
    mutationKey: ['qb', client.scope, identity],
    mutationFn: async (variables: V) => {
      const started = client.getIdentityVersion();
      const data = await options.mutationFn(client, variables);
      if (started !== client.getIdentityVersion())
        throw new Error('QB Flex identity changed during mutation');
      return data;
    },
    onSuccess: () => {
      for (const key of options.invalidate ?? [])
        void cache.invalidateQueries({ queryKey: ['qb', client.scope, identity, ...key] });
    },
  });
}
export function useQBRealtime(
  options: ChannelOptions & { enabled?: boolean; invalidate?: QueryKey[] },
) {
  const client = useQBClient();
  const identity = useIdentity();
  const cache = useQueryClient();
  const [status, setStatus] = useState('disconnected');
  const ref = useRef(options);
  ref.current = options;
  useEffect(() => {
    if (options.enabled === false) return;
    const invalidate = () => {
      for (const key of ref.current.invalidate ?? [])
        void cache.invalidateQueries({ queryKey: ['qb', client.scope, identity, ...key] });
    };
    const channel = client
      .channel({
        table: options.table,
        cursor: options.cursor,
        onEvent: (event) => {
          ref.current.onEvent(event);
          invalidate();
        },
        onStatus: (value) => {
          setStatus(value);
          ref.current.onStatus?.(value);
        },
        onResync: () => {
          invalidate();
          ref.current.onResync?.();
        },
      })
      .subscribe();
    return () => channel.unsubscribe();
  }, [client, identity, options.enabled, options.table, options.cursor, cache]);
  return { status };
}
export function useQBStorage() {
  const client = useQBClient();
  const active = useRef(true);
  const pending = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = async <T,>(fn: () => Promise<T>) => {
    pending.current++;
    if (active.current) {
      setPending(true);
      setError(null);
    }
    try {
      return await fn();
    } catch (e) {
      if (active.current) setError(e as Error);
      throw e;
    } finally {
      pending.current--;
      if (active.current) setPending(pending.current > 0);
    }
  };
  return {
    isPending,
    error,
    upload: (...args: Parameters<typeof client.storage.upload>) =>
      run(() => client.storage.upload(...args)),
    download: (...args: Parameters<typeof client.storage.download>) =>
      run(() => client.storage.download(...args)),
    remove: (...args: Parameters<typeof client.storage.remove>) =>
      run(() => client.storage.remove(...args)),
    list: client.storage.list,
  };
}
