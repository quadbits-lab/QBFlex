# SDK export declarations

Generated from the actual 0.1.0 SDK declaration artifacts. Integer types preserve precision; omitted exposure columns are absent from generated database types.

## @qb-flex/client

```ts
import { type DatabaseShape, type RowOf, type InsertOf, type UpdateOf, type Query, type Result, type Session, type Filter, type RelationsOf } from './contracts';
export { QBError } from './contracts';
export type { Result, Session, Query } from './contracts';
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
export type RPCShape = Record<string, {
    Args: Record<string, unknown>;
    Returns: unknown;
}>;
export declare function createClient<D = DatabaseShape, R = RPCShape>(options: ClientOptions): QBClient<D, R>;
export declare class QBClient<D = DatabaseShape, R = RPCShape> {
    readonly options: ClientOptions;
    readonly baseURL: string;
    readonly scope: string;
    private token;
    private session;
    private listeners;
    private refreshPromise;
    private channels;
    private disposed;
    private epoch;
    private pending;
    constructor(options: ClientOptions);
    getSession(): Session | null;
    getIdentityVersion(): number;
    getToken(): string | null;
    onAuthStateChange(listener: (session: Session | null) => void): () => void;
    private setSession;
    request<T>(path: string, method?: string, body?: unknown, options?: RequestOptions & {
        safe?: boolean;
        raw?: boolean;
        auth?: boolean;
        refresh?: boolean;
    }): Promise<T>;
    private delay;
    from<K extends keyof D & string>(table: K): QueryBuilder<D, K, RowOf<D, K>>;
    auth: {
        signUp: (input: {
            email: string;
            password: string;
            name: string;
        }) => Promise<{
            user: any;
            token: any;
        } | null>;
        signIn: (input: {
            email: string;
            password: string;
        }) => Promise<{
            user: any;
            token: any;
        }>;
        signOut: () => Promise<void>;
        refreshSession: () => Promise<Session | null>;
        resetPassword: (email: string, redirectTo: string) => Promise<unknown>;
        updatePassword: (token: string, newPassword: string) => Promise<unknown>;
        sendVerification: (email: string, callbackURL: string) => Promise<unknown>;
        signInWithProvider: (provider: "google" | "github", callbackURL: string) => Promise<{
            url: string;
        }>;
    };
    rpc<K extends keyof R & string>(operation: K, args: R[K] extends {
        Args: infer A;
    } ? A : never, options?: RequestOptions): Promise<Result<R[K] extends {
        Returns: infer T;
    } ? T : unknown>>;
    channel(options: ChannelOptions): QBChannel;
    storage: {
        listBuckets: () => Promise<Result<any[]>>;
        list: (bucket: string) => Promise<Result<any[]>>;
        upload: (bucket: string, key: string, file: Blob, options?: RequestOptions) => Promise<Result<{
            id: string;
            state: string;
        }>>;
        download: (id: string, options?: RequestOptions) => Promise<Blob>;
        remove: (id: string, options?: RequestOptions) => Promise<Result<{
            deleted: boolean;
        }>>;
    };
    dispose(): void;
}
export declare class QueryBuilder<D, K extends keyof D & string, R> implements PromiseLike<Result<R[]>> {
    private client;
    private table;
    private query;
    private options;
    constructor(client: QBClient<D, any>, table: K, query: Query, options?: RequestOptions);
    private next;
    select<C extends keyof RowOf<D, K> & string>(columns?: C[]): QueryBuilder<D, K, Pick<RowOf<D, K>, C>>;
    filter(column: keyof RowOf<D, K> & string, op: Filter['op'], value?: Filter['value']): QueryBuilder<D, K, R>;
    eq<C extends keyof RowOf<D, K> & string>(column: C, value: RowOf<D, K>[C]): QueryBuilder<D, K, R>;
    order(column: keyof RowOf<D, K> & string, direction?: 'asc' | 'desc'): QueryBuilder<D, K, R>;
    limit(limit: number): QueryBuilder<D, K, R>;
    cursor(cursor: string): QueryBuilder<D, K, R>;
    include<N extends keyof RelationsOf<D, K> & string>(relations: {
        name: N;
        columns?: string[];
        limit?: number;
    }[]): QueryBuilder<D, K, R & Pick<RelationsOf<D, K>, N>>;
    count(): QueryBuilder<D, K, R>;
    abortSignal(signal: AbortSignal): QueryBuilder<D, K, R>;
    execute(): Promise<Result<R[]>>;
    then<A = Result<R[]>, B = never>(fulfilled?: ((result: Result<R[]>) => A | PromiseLike<A>) | null, rejected?: ((reason: any) => B | PromiseLike<B>) | null): PromiseLike<A | B>;
    insert(row: InsertOf<D, K> | InsertOf<D, K>[], options?: RequestOptions): Promise<Result<RowOf<D, K>[]>>;
    upsert(row: InsertOf<D, K> | InsertOf<D, K>[], options?: RequestOptions): Promise<Result<RowOf<D, K>[]>>;
    update(key: string | number | unknown[], row: UpdateOf<D, K>, options?: RequestOptions): Promise<Result<RowOf<D, K>[]>>;
    delete(key: string | number | unknown[], options?: RequestOptions): Promise<Result<RowOf<D, K>[]>>;
}
export declare class QBChannel {
    private client;
    private options;
    private onDispose;
    private socket;
    private stopped;
    private retry;
    private timer?;
    private heartbeat?;
    private cursor?;
    private seen;
    constructor(client: QBClient<any, any>, options: ChannelOptions, onDispose: () => void);
    subscribe(): this;
    private connect;
    reauthenticate(): void;
    unsubscribe(): void;
}

```

## @qb-flex/react

```ts
import { type ReactNode } from 'react';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { QBClient, type Session, type ChannelOptions } from '@qb-flex/client';
export interface QBProviderProps {
    client: QBClient<any, any>;
    queryClient?: QueryClient;
    children: ReactNode;
}
/** Supply a stable client created outside rendering, or once with useState. */
export declare function QBProvider({ client, queryClient, children }: QBProviderProps): import("react").JSX.Element;
export declare function useQBClient<D = any, R = any>(): QBClient<D, R>;
export declare function useQBAuth(): {
    session: Session | null;
    user: {
        id: string;
        email: string;
        name: string;
    } | null;
    isLoading: boolean;
    error: Error | null;
    signIn: (input: Parameters<(input: {
        email: string;
        password: string;
    }) => Promise<{
        user: any;
        token: any;
    }>>[0]) => Promise<{
        user: any;
        token: any;
    }>;
    signUp: (input: Parameters<(input: {
        email: string;
        password: string;
        name: string;
    }) => Promise<{
        user: any;
        token: any;
    } | null>>[0]) => Promise<{
        user: any;
        token: any;
    } | null>;
    signOut: () => Promise<void>;
    refresh: () => Promise<Session | null>;
};
export declare function useQBQuery<T, D = any>(options: {
    queryKey: QueryKey;
    queryFn: (client: QBClient<D>, signal: AbortSignal) => PromiseLike<T>;
    enabled?: boolean;
}): import("@tanstack/react-query").UseQueryResult<T, Error>;
export declare function useQBMutation<T, V, D = any>(options: {
    mutationFn: (client: QBClient<D>, variables: V) => Promise<T>;
    invalidate?: QueryKey[];
}): import("@tanstack/react-query").UseMutationResult<T, Error, V, unknown>;
export declare function useQBRealtime(options: ChannelOptions & {
    enabled?: boolean;
    invalidate?: QueryKey[];
}): {
    status: string;
};
export declare function useQBStorage(): {
    isPending: boolean;
    error: Error | null;
    upload: (bucket: string, key: string, file: Blob, options?: import("@qb-flex/client").RequestOptions | undefined) => Promise<import("@qb-flex/contracts").Result<{
        id: string;
        state: string;
    }>>;
    download: (id: string, options?: import("@qb-flex/client").RequestOptions | undefined) => Promise<Blob>;
    remove: (id: string, options?: import("@qb-flex/client").RequestOptions | undefined) => Promise<import("@qb-flex/contracts").Result<{
        deleted: boolean;
    }>>;
    list: (bucket: string) => Promise<import("@qb-flex/contracts").Result<any[]>>;
};

```
