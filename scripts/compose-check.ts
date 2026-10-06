import { createClient, type QBClient } from '@qb-flex/client';
import { ownership } from '../tests/helpers';
const name = 'qb-flex-check-' + crypto.randomUUID().slice(0, 8),
  volume = name + '-data';
async function docker(args: string[], env = process.env) {
  const child = Bun.spawn(['docker', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
  const [out, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error('Container verification failed: ' + error);
  return (args[0] === 'logs' ? out + error : out).trim();
}
interface CheckDatabase {
  tasks: {
    Row: { id: string; owner_id: string; title: string };
    Insert: { id: string; owner_id: string; title: string };
    Update: { title?: string };
  };
}
let client: QBClient<CheckDatabase> | undefined;
try {
  await docker(['volume', 'create', volume]);
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const hostPort = reservation.port;
  await reservation.stop(true);
  const bootstrap = crypto.randomUUID() + crypto.randomUUID();
  await docker(
    [
      'run',
      '-d',
      '--name',
      name,
      '--network',
      'qb-flex_default',
      '-v',
      volume + ':/var/lib/qb-flex',
      '-p',
      `127.0.0.1:${hostPort}:7612`,
      '-e',
      'QB_BOOTSTRAP_TOKEN',
      '-e',
      'QB_MASTER_KEY',
      '-e',
      'QB_SCHEDULED_BACKUPS=false',
      '-e',
      'QB_S3_ENDPOINT=http://minio:9000',
      '-e',
      'QB_S3_REGION=us-east-1',
      '-e',
      'QB_S3_BUCKET=qb-flex',
      '-e',
      'QB_S3_ACCESS_KEY=qbflex-local',
      '-e',
      'QB_S3_SECRET_KEY=qbflex-local-development',
      '-e',
      'QB_SMTP_HOST=mailpit',
      '-e',
      'QB_SMTP_PORT=1025',
      'qb-flex-api',
    ],
    {
      ...process.env,
      QB_BOOTSTRAP_TOKEN: bootstrap,
      QB_MASTER_KEY: crypto.randomUUID() + crypto.randomUUID(),
    },
  );
  const port = (await docker(['port', name, '7612/tcp'])).split(':').at(-1),
    url = 'http://localhost:' + port;
  async function ready() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(url + '/ready', { signal: AbortSignal.timeout(1000) })).ok) return;
      } catch {}
      await Bun.sleep(100);
    }
    throw new Error('Clean container did not become ready: ' + (await docker(['logs', name])));
  }
  await ready();
  let token: string | undefined;
  async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(url + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error('Clean API ' + path + ': ' + data.error?.code);
    return data;
  }
  await api('/setup', 'POST', {
    bootstrapToken: bootstrap,
    email: 'container-owner@example.com',
    name: 'Container owner',
    password: 'container-owner-password-12345',
  });
  token = (
    await api('/platform/auth/sign-in/email', 'POST', {
      email: 'container-owner@example.com',
      password: 'container-owner-password-12345',
    })
  ).token;
  const org = (await api('/management/v1/organizations')).data[0];
  const project = (
    await api('/management/v1/projects', 'POST', {
      organizationId: org.id,
      slug: 'container-quickstart',
      name: 'Container quickstart',
    })
  ).data;
  const deadline = Date.now() + 15000;
  let status = '';
  while (Date.now() < deadline) {
    status = (await api('/management/v1/operations/' + project.operationId)).data.status;
    if (status === 'succeeded') break;
    if (status === 'failed') throw new Error('Provisioning failed');
    await Bun.sleep(100);
  }
  if (status !== 'succeeded') throw new Error('Provisioning deadline exceeded');
  const base = `/management/v1/projects/${project.id}/branches/${project.branchId}`;
  await api(base + '/migrations', 'POST', {
    id: '001',
    sql: 'CREATE TABLE tasks(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,title TEXT NOT NULL);',
  });
  const key = (await api(`/management/v1/projects/${project.id}/keys`, 'POST', {})).data.key;
  client = createClient<CheckDatabase>({
    url,
    projectId: project.id,
    branch: project.branchId,
    publishableKey: key,
  });
  await client
    .from('tasks')
    .execute()
    .then(
      () => {
        throw new Error('Private table became accessible');
      },
      (error) => {
        if (error.status !== 404) throw error;
      },
    );
  await api(base + '/exposure/tasks', 'PUT', {
    enabled: true,
    columns: ['id', 'owner_id', 'title'],
  });
  for (const operation of ['select', 'insert', 'update', 'delete'])
    await api(base + '/policies', 'PUT', {
      resource: 'tasks',
      operation,
      roles: ['authenticated'],
      mode: 'permissive',
      using: ownership,
      check: ownership,
      enabled: true,
    });
  const session = await client.auth.signUp({
    email: 'container-user@example.com',
    name: 'Container user',
    password: 'container-user-password-12345',
  });
  let connected = false,
    received = false;
  const channel = client
    .channel({
      table: 'tasks',
      onStatus: (value) => {
        connected = value === 'connected';
      },
      onEvent: (event) => {
        received = event.payload.id === 'durable';
      },
    })
    .subscribe();
  const wait = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) await Bun.sleep(20);
    if (!predicate()) throw new Error('Realtime deadline exceeded');
  };
  await wait(() => connected);
  await client
    .from('tasks')
    .insert(
      { id: 'durable', owner_id: session!.user.id, title: 'Acknowledged before restart' },
      { idempotencyKey: 'container-write' },
    );
  await wait(() => received);
  channel.unsubscribe();
  const bucket = (
    await api(base + '/buckets', 'POST', {
      name: 'files',
      visibility: 'private',
      maxSize: 1024,
      mimeRules: ['text/plain'],
    })
  ).data.id;
  const uploaded = await client.storage.upload(
    bucket,
    'container.txt',
    new Blob(['container bytes'], { type: 'text/plain' }),
    { idempotencyKey: 'container-upload' },
  );
  if ((await (await client.storage.download(uploaded.data.id)).text()) !== 'container bytes')
    throw new Error('Object bytes differ');
  const generated = await fetch(url + base + '/types', {
    headers: { authorization: 'Bearer ' + token },
  });
  if (!(await generated.text()).includes('export interface Database'))
    throw new Error('Generated types missing');
  await docker(['restart', name]);
  await ready();
  if ((await client.from('tasks').execute()).data[0].title !== 'Acknowledged before restart')
    throw new Error('Acknowledged commit did not survive restart');
  const backup = (await api(base + '/backups', 'POST', {})).data;
  const restore = (
    await api(`/management/v1/projects/${project.id}/backups/${backup.id}/restore`, 'POST', {})
  ).data;
  if (restore.status !== 'ready' || !restore.sessionsExcluded)
    throw new Error('Restore validation failed');
  await client.storage.remove(uploaded.data.id);
  console.log(
    'Clean Linux API container/volume: setup → project → private table → policies → auth → CRUD → realtime → S3 → types → restart durability → encrypted restore passed.',
  );
} finally {
  client?.dispose();
  await docker(['rm', '-f', name]).catch(() => {});
  await docker(['volume', 'rm', volume]).catch(() => {});
}
