<div align="center">

# @qbflex/client

**The framework-independent JavaScript and TypeScript client for QB Flex.**

Build browser applications with typed data access, application authentication, realtime updates,
RPCs, search, and private file storage.

[Documentation](https://docs.flex.quadbits.app/) ·
[JavaScript quickstart](https://docs.flex.quadbits.app/docs/sdk/vanilla/quickstart) ·
[React SDK](https://docs.flex.quadbits.app/docs/sdk/react/quickstart)

</div>

## Why @qbflex/client?

- **Framework independent** — use it with TypeScript, Vanilla JavaScript, or your preferred UI framework.
- **Typed data access** — generated database and RPC types keep queries and mutations aligned with your schema.
- **Application authentication** — email/password, magic links, OAuth, passkeys, TOTP, and session refresh share one client.
- **Realtime by default** — subscribe to authorized table changes with cursor-based resynchronization.
- **Private storage** — list, upload, download, and remove objects through the same project and branch boundary.
- **Production-aware requests** — cancellation, timeouts, retryable error metadata, idempotency keys, and revision checks are built in.

## Installation

```sh
npm install @qbflex/client
```

The package ships as browser ESM with TypeScript declarations and has no React dependency.

## Quick start

```ts
import { createClient } from '@qbflex/client';

const qb = createClient({
  url: 'https://api.example.com',
  projectId: 'your-project-id',
  branch: 'primary',
  publishableKey: 'your-publishable-key',
});

await qb.auth.signIn({
  email: 'you@example.com',
  password: 'your-password',
});

const { data: tasks, meta } = await qb
  .from('tasks')
  .select(['id', 'title', 'completed'])
  .eq('completed', false)
  .order('created_at', 'desc')
  .limit(50)
  .execute();

console.log(tasks, meta.cursor);
```

Only publishable project keys belong in browser bundles. Data exposure and row policies are always
enforced by the QB Flex API.

## Client configuration

| Option           | Required | Description                                                                |
| ---------------- | -------- | -------------------------------------------------------------------------- |
| `url`            | Yes      | Absolute HTTP(S) URL of the QB Flex API.                                   |
| `projectId`      | Yes      | Project that owns the application data and auth realm.                     |
| `publishableKey` | Yes      | Browser-safe project key. Never use a service or management key here.      |
| `branch`         | No       | Branch ID or `primary` alias. Defaults to `primary`.                       |
| `timeoutMs`      | No       | Request timeout in milliseconds. Defaults to 15 seconds.                   |
| `credentials`    | No       | Fetch credential mode. Defaults to `include`.                              |
| `fetch`          | No       | Custom Fetch-compatible implementation for testing or runtime integration. |

## Common workflows

### Write data

```ts
await qb
  .from('tasks')
  .insert({ title: 'Ship the SDK', completed: false }, { idempotencyKey: crypto.randomUUID() });

await qb.from('tasks').update('task-id', { completed: true });
```

### Subscribe to changes

```ts
const channel = qb
  .channel({
    table: 'tasks',
    cursor: meta.consistencyToken,
    onEvent: (event) => console.log(event),
    onResync: () => {
      // Fetch a fresh authorized snapshot before resuming.
    },
  })
  .subscribe();

// Later:
channel.unsubscribe();
```

### Handle errors

```ts
import { QBError } from '@qbflex/client';

try {
  await qb.from('tasks').select().execute();
} catch (error) {
  if (error instanceof QBError) {
    console.error(error.code, error.status, error.retryable);
  }
}
```

## Available APIs

| Area           | Entry point                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Data           | `qb.from(table)` for reads, inserts, upserts, updates, deletes, relations, counts, and aggregates |
| Authentication | `qb.auth` for sessions, email/password, magic links, OAuth, passkeys, TOTP, and account recovery  |
| Realtime       | `qb.channel(options)` for authorized database events and resynchronization                        |
| Storage        | `qb.storage` for private bucket objects                                                           |
| RPC            | `qb.rpc(operation, args)` for reviewed operations                                                 |
| Search         | `qb.search(input)` for configured search collections                                              |

## Lifecycle

Create one client per browser application configuration or per server request. When the owning
application is torn down, unsubscribe listeners and channels, then dispose the client:

```ts
const unsubscribeAuth = qb.onAuthStateChange((session) => {
  console.log(session?.user ?? 'signed out');
});

unsubscribeAuth();
qb.dispose();
```

Session state stays in memory and in API-managed cookies; do not copy tokens into `localStorage`.
Use HTTPS and configure the exact application origin for production deployments.

## Documentation

Explore the complete guides, authentication flows, query patterns, realtime lifecycle, and storage
examples at **[docs.flex.quadbits.app](https://docs.flex.quadbits.app/)**.
