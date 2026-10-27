<div align="center">

# @qbflex/react

**Reactive QB Flex data, authentication, realtime, and storage hooks for React 19.**

Connect a shared `@qbflex/client` instance to a provider-scoped TanStack Query cache with
lifecycle-safe hooks for modern React applications.

[Documentation](https://docs.flex.quadbits.app/) ·
[React quickstart](https://docs.flex.quadbits.app/docs/sdk/react/quickstart) ·
[JavaScript client](https://docs.flex.quadbits.app/docs/sdk/vanilla/quickstart)

</div>

## Why @qbflex/react?

- **Small React adapter** — the same client powers React and framework-independent applications.
- **Provider-scoped cache** — each provider owns an isolated TanStack Query cache or accepts yours.
- **Identity-safe data** — session changes cancel stale work and remove protected cached results.
- **Typed hooks** — query and mutation callbacks retain the client database types.
- **Realtime invalidation** — table events can refresh the exact application query keys you choose.
- **SSR-aware lifecycle** — anonymous server snapshots, request-local clients, cancellation, and cleanup are built in.

## Installation

```sh
npm install @qbflex/client @qbflex/react react react-dom
```

React 19 is required. `@tanstack/react-query` is installed as a package dependency.

## Quick start

Create a stable client outside the component tree and pass it to `QBProvider`:

```tsx
import { createClient } from '@qbflex/client';
import { QBProvider, useQBQuery } from '@qbflex/react';

const client = createClient({
  url: 'https://api.example.com',
  projectId: 'your-project-id',
  branch: 'primary',
  publishableKey: 'your-publishable-key',
});

function Tasks() {
  const tasks = useQBQuery({
    queryKey: ['tasks', { completed: false }],
    queryFn: (qb, signal) =>
      qb.from('tasks').select(['id', 'title']).eq('completed', false).abortSignal(signal).execute(),
  });

  if (tasks.isPending) return <p>Loading tasks…</p>;
  if (tasks.error) return <p role="alert">{tasks.error.message}</p>;

  return (
    <ul>
      {tasks.data.data.map((task) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  );
}

export function App() {
  return (
    <QBProvider client={client}>
      <Tasks />
    </QBProvider>
  );
}
```

Only publishable project keys belong in browser bundles. QB Flex row policies remain the
authorization boundary; hook state is not a replacement for server-side access control.

## Hooks

| Export            | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `QBProvider`      | Provides a stable client, auth actions, and isolated query cache.           |
| `useQBClient()`   | Accesses the configured client with optional database and RPC generics.     |
| `useQBAuth()`     | Exposes the session, user, loading/error state, auth actions, and passkeys. |
| `useQBQuery()`    | Runs a cancellable query with identity-scoped cache keys.                   |
| `useQBMutation()` | Runs a typed mutation and invalidates explicit application keys.            |
| `useQBSearch()`   | Queries a configured search collection.                                     |
| `useQBRealtime()` | Manages a table subscription, status, resync, and cache invalidation.       |
| `useQBStorage()`  | Lists, uploads, downloads, and removes private objects.                     |

## Authentication

```tsx
import { useQBAuth } from '@qbflex/react';

function Account() {
  const auth = useQBAuth();

  if (auth.isLoading) return <p>Checking session…</p>;
  if (auth.user) {
    return (
      <button onClick={() => void auth.signOut().catch(console.error)}>
        Sign out {auth.user.email}
      </button>
    );
  }

  return (
    <button
      onClick={() =>
        void auth
          .signIn({
            email: 'you@example.com',
            password: 'your-password',
          })
          .catch(console.error)
      }
    >
      Sign in
    </button>
  );
}
```

Authentication actions reject on failure. Catch rejected promises in production UI and render the
hook's `error` state where users can act on it.

## Mutations and invalidation

```tsx
import { useQBMutation } from '@qbflex/react';

function AddTask() {
  const createTask = useQBMutation({
    mutationFn: (qb, title: string) =>
      qb.from('tasks').insert({ title, completed: false }, { idempotencyKey: crypto.randomUUID() }),
    invalidate: [['tasks']],
  });

  return (
    <button onClick={() => createTask.mutate('Read the SDK guide')}>
      {createTask.isPending ? 'Adding…' : 'Add task'}
    </button>
  );
}
```

Application query keys should include every filter or pagination input. The adapter prefixes those
keys with the client scope and current identity automatically.

## Realtime invalidation

```tsx
import { useQBRealtime } from '@qbflex/react';

function TaskRealtimeStatus() {
  const realtime = useQBRealtime({
    table: 'tasks',
    invalidate: [['tasks']],
    onEvent: (event) => console.log(event),
    onResync: () => {
      // Invalidated queries fetch a fresh authorized snapshot.
    },
  });

  return <p>Realtime: {realtime.status}</p>;
}
```

Subscriptions are opened from an effect and cleaned up automatically. A resync should replace stale
local data through refetching rather than appending events to an incomplete snapshot.

## Provider and SSR guidance

- Keep the client stable; do not call `createClient()` during every render.
- Create a separate client and query cache for every server request.
- Pass an existing `QueryClient` through `queryClient` when integrating with an application cache.
- Dispose the client after its provider subtree has unmounted; the provider does not own a supplied client.
- Forward the `AbortSignal` received by `useQBQuery` to the SDK query builder.

## Documentation

Explore the full React quickstart, authentication, storage, realtime, and hook lifecycle guides at
**[docs.flex.quadbits.app](https://docs.flex.quadbits.app/)**.
