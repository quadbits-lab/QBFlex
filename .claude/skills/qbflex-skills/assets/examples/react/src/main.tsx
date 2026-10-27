import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type QBClient } from '@qbflex/client';
import {
  QBProvider,
  useQBClient,
  useQBAuth,
  useQBQuery,
  useQBMutation,
  useQBRealtime,
  useQBStorage,
} from '@qbflex/react';
import './styles.css';
import type { Database as TasksDatabase, RPC } from './qb-flex.types';
function Root() {
  const [client, setClient] = useState<QBClient<TasksDatabase, RPC> | null>(null);
  const [url, setURL] = useState('http://localhost:7612'),
    [project, setProject] = useState(''),
    [key, setKey] = useState(''),
    [branch, setBranch] = useState('primary');
  return (
    <main className="example">
      <p className="eyebrow">QB FLEX / REACT EXAMPLE</p>
      <h1>A little room to get things done.</h1>
      <p className="muted">
        Authentication, protected tasks, realtime and files — using the React provider and hooks.
      </p>
      {!client ? (
        <form
          className="panel example-form"
          onSubmit={(e) => {
            e.preventDefault();
            setClient(
              createClient<TasksDatabase, RPC>({
                url,
                projectId: project,
                branch,
                publishableKey: key,
              }),
            );
          }}
        >
          <label>
            API URL
            <input value={url} onChange={(e) => setURL(e.target.value)} required />
          </label>
          <label>
            Project ID
            <input value={project} onChange={(e) => setProject(e.target.value)} required />
          </label>
          <label>
            Branch
            <input value={branch} onChange={(e) => setBranch(e.target.value)} required />
          </label>
          <label>
            Publishable key
            <input value={key} onChange={(e) => setKey(e.target.value)} required />
          </label>
          <button className="button button-primary">Connect project</button>
        </form>
      ) : (
        <QBProvider client={client}>
          <Tasks />
          <button
            className="button button-ghost"
            onClick={() => {
              client.dispose();
              setClient(null);
            }}
          >
            Change project
          </button>
        </QBProvider>
      )}
    </main>
  );
}
function Tasks() {
  const client = useQBClient<TasksDatabase, RPC>();
  const auth = useQBAuth();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [register, setRegister] = useState(false),
    [title, setTitle] = useState(''),
    [error, setError] = useState('');
  const tasks = useQBQuery({
    queryKey: ['tasks'],
    enabled: !!auth.user,
    queryFn: (_, signal) => client.from('tasks').abortSignal(signal).execute(),
  });
  const add = useQBMutation({
    mutationFn: (_, input: { title: string; key: string }) =>
      client
        .from('tasks')
        .insert({ title: input.title, owner_id: auth.user!.id }, { idempotencyKey: input.key }),
    invalidate: [['tasks']],
  });
  const update = useQBMutation({
    mutationFn: (_, task: TasksDatabase['tasks']['Row']) =>
      client
        .from('tasks')
        .update(
          task.id,
          { completed: task.completed ? 0 : 1 },
          { revision: Number(task.revision) },
        ),
    invalidate: [['tasks']],
  });
  const remove = useQBMutation({
    mutationFn: (_, id: string) => client.from('tasks').delete(id),
    invalidate: [['tasks']],
  });
  const realtime = useQBRealtime({
    table: 'tasks',
    enabled: !!auth.user,
    cursor: tasks.data?.meta.consistencyToken,
    onEvent: () => {},
    invalidate: [['tasks']],
  });
  const handle = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (auth.isLoading && !auth.user) return <p>Checking session…</p>;
  if (!auth.user)
    return (
      <form
        className="panel example-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handle(() =>
            register ? auth.signUp({ name, email, password }) : auth.signIn({ email, password }),
          );
        }}
      >
        <h2>{register ? 'Create an application account' : 'Sign in to your application'}</h2>
        {register && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={12}
            required
          />
        </label>
        {error && (
          <p role="alert" className="notice notice-error">
            {error}
          </p>
        )}
        <div className="flex">
          <button className="button button-primary" disabled={auth.isLoading}>
            {register ? 'Create account' : 'Sign in'}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setRegister((v) => !v)}
          >
            {register ? 'Use existing account' : 'Register'}
          </button>
        </div>
      </form>
    );
  return (
    <div className="stack">
      <div className="example-account">
        <div>
          <strong>{auth.user.email}</strong>
          <small>Realtime: {realtime.status}</small>
        </div>
        <button className="button button-secondary" onClick={() => handle(() => auth.signOut())}>
          Sign out
        </button>
      </div>
      <section className="panel example-form">
        <h2>Your tasks</h2>
        <form
          className="task-input"
          onSubmit={(e) => {
            e.preventDefault();
            void handle(async () => {
              await add.mutateAsync({ title, key: crypto.randomUUID() });
              setTitle('');
            });
          }}
        >
          <input
            aria-label="New task"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <button className="button button-primary" disabled={add.isPending}>
            Add task
          </button>
        </form>
        {tasks.isPending ? (
          <p className="muted">Loading tasks…</p>
        ) : tasks.error ? (
          <p role="alert">{tasks.error.message}</p>
        ) : tasks.data?.data.length ? (
          <ul className="task-list">
            {tasks.data.data.map((task) => (
              <li key={task.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!task.completed}
                    onChange={() => handle(() => update.mutateAsync(task))}
                  />
                  <span className={task.completed ? 'completed' : ''}>{task.title}</span>
                </label>
                <button
                  aria-label={`Delete ${task.title}`}
                  className="button button-ghost"
                  onClick={() => handle(() => remove.mutateAsync(task.id))}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No tasks yet. Add your first one.</p>
        )}
        {error && (
          <p role="alert" className="notice notice-error">
            {error}
          </p>
        )}
      </section>
      <Files client={client} />
    </div>
  );
}
function Files({ client }: { client: QBClient<TasksDatabase, RPC> }) {
  const storage = useQBStorage();
  const [bucket, setBucket] = useState(''),
    [object, setObject] = useState('');
  return (
    <section className="panel example-form">
      <h2>Attachments</h2>
      <label>
        Bucket ID
        <input
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          placeholder="Create a bucket in Studio"
        />
      </label>
      <label>
        File
        <input
          type="file"
          disabled={!bucket || storage.isPending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              try {
                const result = await storage.upload(bucket, file.name, file);
                setObject(result.data.id);
              } catch {}
            }
          }}
        />
      </label>
      {object && (
        <div className="flex">
          <button
            className="button button-secondary"
            onClick={async () => {
              try {
                const blob = await storage.download(object);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'attachment';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch {}
            }}
          >
            Download attachment
          </button>
          <button
            className="button button-ghost"
            onClick={async () => {
              try {
                await storage.remove(object);
                setObject('');
              } catch {}
            }}
          >
            Delete attachment
          </button>
        </div>
      )}
      {storage.isPending && <p>Transferring file…</p>}
      {storage.error && <p role="alert">{storage.error.message}</p>}
    </section>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
