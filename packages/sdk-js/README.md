# @qbflex/client

Browser ESM client for QB Flex: database, authentication, realtime and storage. Vanilla JavaScript and TypeScript are supported. Use a publishable project key; credentials and data access are checked by the server.

```js
import { createClient } from '@qbflex/client';
const qb = createClient({
  url: 'http://localhost:7612',
  projectId: 'your-project-id',
  branch: 'primary',
  publishableKey: 'your-publishable-key',
});
await qb.auth.signIn({ email: 'you@example.com', password: 'your-password' });
const result = await qb.from('tasks').select(['id', 'title']).limit(50);
```

Read the dedicated Vanilla JavaScript tutorials in the QB Flex Docs app. Session tokens remain in memory; cookies are managed by the API. Dispose clients and subscriptions when leaving the application.
