# React SDK

Use the actual [generated exports](generated/sdk.md) and [runnable React tasks](../assets/examples/react/package.json). The package builds on `@qb-flex/client` and TanStack Query; it is not a separate auth implementation.

## Client and provider

Create a stable typed client once for the selected configuration. The bundled example creates it on explicit project connection and wraps the task tree in `<QBProvider client={client}>`. Avoid `createClient()` on every render. A configuration change should dispose the old client after unmounting its application subtree. The caller owns client disposal; provider unmount does not implicitly dispose a supplied client.

`QBProvider` creates a stable provider-scoped QueryClient, or accepts `queryClient` for integration. All hooks outside a provider throw an actionable configuration error. On a server create clients and caches per request, never a shared authenticated singleton. No window/localStorage access should run during SSR. Server auth hydration is an explicit integration, not an assumption that browser cookies are available to a server-rendered client.

## Hooks

| Hook | Use |
| --- | --- |
| `useQBClient<Database,RPC>()` | Access the configured typed client |
| `useQBAuth()` | Shared session/user, isLoading/error, signIn/signUp/signOut/refresh |
| `useQBQuery({queryKey,queryFn,enabled})` | Explicit application key, typed results, TanStack Query loading/error/refetch; forward callback signal |
| `useQBMutation({mutationFn,invalidate})` | Typed variables/results, pending/error, explicit invalidation keys |
| `useQBRealtime({table,cursor,onEvent,onStatus,onResync,enabled,invalidate})` | Subscription status, replay cursor, invalidation, effect cleanup |
| `useQBStorage()` | Upload/download/remove actions and transfer pending/error |

`useQBQuery` queryFn receives `(client, signal)`; `useQBMutation` mutationFn receives `(client, variables)`. Query results retain the SDK `{data,meta}` envelope inside TanStack Query's `.data`. Use `query.data?.data`, not an assumed row array directly. `useQBRealtime` supports onResync: invalidation/refetch must replace stale local state, not only append replay events. Storage download returns Blob; revoke temporary object URLs after initiating the download.

## Identity, cancellation and lifecycle

Cache keys contain `['qb', client.scope, identity, ...queryKey]`. Scope includes URL/project/branch; identity includes the session generation, never raw tokens. Give queries complete explicit keys for filters/pagination. Mutation invalidation takes application keys, for example `[['tasks']]`. Session changes cancel work and remove affected QB data, and subscriptions reauthorize. Do not keep protected results in unrelated global state that survives signout.

For protected queries use `enabled: Boolean(auth.user)` as a UI optimization; server policies still enforce access. Signup can require verification before a session exists. Catch rejected auth/mutation promises and render useful errors. Strict Mode mounts/cleans up effects repeatedly: return subscription cleanup and unsubscribe auth listeners; do not open sockets during render. Verify shared session updates, cancellation, query cache identity isolation, anonymous SSR and unmount cleanup with [lifecycle evidence](verification.md).
