import { Database } from '@qb-flex/database';
import { createRealm } from '@qb-flex/auth';
import { Elysia } from 'elysia';
import { createYoga, createSchema } from 'graphql-yoga';

const db = new Database(':memory:');
const second = new Database(':memory:');
const auth = await createRealm(db, {
  secret: 'compatibility-secret-at-least-thirty-two-chars',
  baseURL: 'http://localhost:7612',
  basePath: '/auth',
  origins: [],
});
const isolated = await createRealm(second, {
  secret: 'different-secret-at-least-thirty-two-chars',
  baseURL: 'http://localhost:7612',
  basePath: '/other',
  origins: [],
});
const registration = await auth.api.signUpEmail({
  body: {
    name: 'Compatibility',
    email: 'spike@example.com',
    password: 'compatibility-test-password',
  },
});
const session = await isolated.api.getSession({
  headers: new Headers({ authorization: `Bearer ${registration.token}` }),
});
if (session) throw new Error('Auth realm isolation failed');
const yoga = createYoga({
  schema: createSchema({
    typeDefs: 'type Query { health: String! }',
    resolvers: { Query: { health: () => 'ok' } },
  }),
  graphqlEndpoint: '/graphql',
});
const app = new Elysia().all('/graphql', ({ request }) => yoga.fetch(request));
const response = await app.handle(
  new Request('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{health}' }),
  }),
);
if ((await response.json()).data.health !== 'ok') throw new Error('GraphQL mount failed');
console.log(
  JSON.stringify(
    {
      bun: Bun.version,
      authIsolation: 'passed',
      graphqlMount: 'passed',
      databaseEngine: 'pglite',
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2,
  ),
);
await db.close();
await second.close();
