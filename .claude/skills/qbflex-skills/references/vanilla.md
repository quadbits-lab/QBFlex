# Vanilla JavaScript SDK

Use `createClient<Database,RPC>({url,projectId,branch,publishableKey})` in TypeScript or the same call without generics in JavaScript. Branch defaults to `primary`; use the immutable branch ID when stable identity matters. The URL must be HTTP(S), without embedded credentials, query or fragment. Only publishable keys belong in browsers. The package has browser ESM and declarations with no React dependency.

## Installation and initialization

[Portable examples](../assets/examples/README.md) document npm installation from locally built tarballs, Vite and direct browser modules. Registry publication is a separate release action. Direct ESM must point to the actual compiled browser `client.js`, never a TypeScript source file or unresolved bare specifier. Configure the project's exact browser origin and use HTTPS in production.

## Auth and queries

Observe sessions using `onAuthStateChange(callback)` and retain its returned unsubscribe function. Refresh initial state with `auth.refreshSession()`. `auth.signUp`, `signIn`, `signOut`, `resetPassword`, `confirmPasswordReset`, `verifyEmail` and credential-configured provider sign-in use project/branch auth. A signup may await email verification. Single-flight refresh avoids duplicate refresh requests; sessions remain memory/cookie state, not user-managed token localStorage.

Read with `from('tasks').select([...]).eq(...).order(...).limit(...).cursor(...).execute()`. Reads are awaitable builders; use `.execute()` when an explicit promise is clearer. Mutations use insert/upsert/update/delete and optional signal/idempotencyKey/revision. Use a controller for replaceable reads and compare identity generations before rendering a completed response. See [application contracts](application.md) for cursor, policy, returned-row and precision behavior.

## Realtime and resynchronization

Subscribe using `client.channel({table,cursor,onEvent,onStatus,onResync}).subscribe()`. Start from `meta.consistencyToken` after a protected snapshot read. Reconnect resumes only within retained history; an expired cursor or oversized image requires a fresh authorized snapshot. Handle `onResync`, replace local state and resume. Do not append events indefinitely or present an event stream as exactly-once delivery. Session changes reauthorize channels; branch changes require a newly configured client.

## Private files and cleanup

Use `storage.listBuckets`, `list`, `upload(bucket,key,Blob)`, `download(objectId)` and `remove(objectId)`. Create a private bucket with size/MIME rules first. Object IDs come from the upload result; paths are not authorization. Incomplete metadata cannot be downloaded. Resumable transfers and custom storage policy AST are planned. Revoke download object URLs after use and reset file IDs/derived UI on identity changes.

On teardown abort pending reads, unsubscribe the channel, unsubscribe auth observation and `client.dispose()`. Disposal closes client-owned listeners/transports. The bundled DOM workflow performs this on pagehide. Errors are normalized QBError instances with code/status/retryable; suppress only expected cancellation. Default timeout is 15 seconds. Reconcile uncertain mutations using their original idempotency key; retryable does not mean that an unkeyed write is safe to repeat. [Troubleshooting](troubleshooting.md) covers recovery.
