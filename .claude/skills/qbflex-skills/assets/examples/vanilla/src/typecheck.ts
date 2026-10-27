import { createClient } from '@qbflex/client';
import type { Database, RPC } from './qb-flex.types';
const client = createClient<Database, RPC>({
  url: 'http://localhost:7612',
  projectId: 'PROJECT_ID',
  branch: 'BRANCH_ID',
  publishableKey: 'PUBLISHABLE_KEY',
});
client.from('tasks').insert({ title: 'Typed task', owner_id: 'APPLICATION_USER_ID' });
client.rpc('create_task', { title: 'Typed RPC' });
async function workflow(signal: AbortSignal, bucket: string, file: Blob) {
  const session = await client.auth.signIn({
    email: 'APPLICATION_EMAIL',
    password: 'APPLICATION_PASSWORD',
  });
  const stop = client.onAuthStateChange(() => {});
  const inserted = await client
    .from('tasks')
    .insert({ title: 'Typed', owner_id: session.user.id }, { idempotencyKey: crypto.randomUUID() });
  const rows = await client
    .from('tasks')
    .select(['id', 'title'])
    .eq('completed', 0)
    .order('id', 'asc')
    .limit(50)
    .abortSignal(signal)
    .execute();
  await client.from('tasks').update(inserted.data[0].id, { completed: 1 }, { revision: 1 });
  const channel = client
    .channel({
      table: 'tasks',
      cursor: rows.meta.consistencyToken,
      onEvent: () => {},
      onResync: () => {
        void client.from('tasks').execute();
      },
    })
    .subscribe();
  const uploaded = await client.storage.upload(bucket, 'attachment.txt', file);
  await client.storage.download(uploaded.data.id);
  await client.storage.remove(uploaded.data.id);
  await client.from('tasks').delete(inserted.data[0].id);
  channel.unsubscribe();
  stop();
  await client.auth.signOut();
}
// @ts-expect-error Hidden column is absent from generated types
client.from('tasks').select(['internal_note']);
// @ts-expect-error owner_id is required
client.from('tasks').insert({ title: 'Missing owner' });
// @ts-expect-error Undeclared RPC argument
client.rpc('create_task', { sql: 'unsupported' });
client.dispose();
