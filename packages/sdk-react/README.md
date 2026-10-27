# @qbflex/react

React 19 context provider and custom hooks for QB Flex. Shares the Vanilla JavaScript client and uses a provider-scoped TanStack Query cache.

```jsx
import { createClient } from '@qbflex/client';
import { QBProvider, useQBQuery } from '@qbflex/react';
const client = createClient({
  url: 'http://localhost:7612',
  projectId: 'your-project-id',
  publishableKey: 'your-publishable-key',
});
function Tasks() {
  const query = useQBQuery({
    queryKey: ['tasks'],
    queryFn: (qb, signal) => qb.from('tasks').abortSignal(signal).execute(),
  });
  if (query.isPending) return <p>Loading…</p>;
  if (query.error) return <p>{query.error.message}</p>;
  return (
    <ul>
      {query.data.data.map((task) => (
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

Exports: `QBProvider`, `useQBClient`, `useQBAuth`, `useQBQuery`, `useQBMutation`, `useQBRealtime`, `useQBStorage`. Read the React tutorials and hook reference in QB Flex Docs.
