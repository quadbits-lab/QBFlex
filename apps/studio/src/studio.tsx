import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { Store, useStore } from '@tanstack/react-store';
import {
  LayoutDashboard,
  Database,
  Users,
  Code2,
  Zap,
  HardDrive,
  Box,
  Sparkles,
  Activity,
  Settings,
  BookOpen,
  ChevronRight,
  Plus,
  GitBranch,
  LogOut,
  PanelLeft,
  ShieldCheck,
  Copy,
} from 'lucide-react';
import {
  Brand,
  AppFooter,
  Button,
  Badge,
  Notice,
  Loading,
  Modal,
  Empty,
  Drawer,
} from '@qb-flex/ui';
import { raw, management, docsURL, apiURL } from './api';
import {
  DatabaseWorkspace,
  AuthWorkspace,
  APIWorkspace,
  StorageWorkspace,
  SettingsWorkspace,
  BackupWorkspace,
} from './workspaces';
const navigation = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Database', icon: Database },
  { name: 'Authentication', icon: Users },
  { name: 'API', icon: Code2 },
  { name: 'Realtime', icon: Zap },
  { name: 'Storage', icon: HardDrive },
  { name: 'Backups', icon: GitBranch },
  { name: 'Functions', icon: Box },
  { name: 'AI & Vectors', icon: Sparkles },
  { name: 'Logs', icon: Activity },
  { name: 'Settings', icon: Settings },
];
export function Studio() {
  const cache = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => raw('/setup') });
  const session = useQuery({
    queryKey: ['platform-session'],
    queryFn: () => raw('/platform/auth/get-session'),
  });
  if (setup.isPending || session.isPending)
    return (
      <AuthLayout>
        <Loading />
      </AuthLayout>
    );
  if (setup.error)
    return (
      <AuthLayout>
        <div className="auth-card panel">
          <Notice kind="error">API unavailable: {setup.error.message}</Notice>
          <Button className="full-width" onClick={() => setup.refetch()}>
            Retry connection
          </Button>
        </div>
      </AuthLayout>
    );
  if (setup.data?.data.required)
    return (
      <AuthForm
        setup
        onDone={() => {
          void cache.invalidateQueries();
        }}
      />
    );
  if (!session.data?.user)
    return (
      <AuthForm
        onDone={() => {
          void cache.invalidateQueries();
        }}
      />
    );
  return <Workspace user={session.data.user} />;
}
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <main id="main" className="auth-content">
        <div className="auth-brand">
          <Brand />
        </div>
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
function AuthForm({ setup = false, onDone }: { setup?: boolean; onDone: () => void }) {
  const [error, setError] = useState(''),
    [challenge, setChallenge] = useState(false),
    [code, setCode] = useState('');
  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      organization: 'Personal workspace',
      bootstrapToken: '',
    },
    onSubmit: async ({ value }) => {
      setError('');
      try {
        const result = await raw(setup ? '/setup' : '/platform/auth/sign-in/email', 'POST', value);
        if (result.twoFactorRedirect) {
          setChallenge(true);
          return;
        }
        onDone();
      } catch (e) {
        setError((e as Error).message);
      }
    },
  });
  const fields = setup
    ? (['name', 'organization', 'email', 'password', 'bootstrapToken'] as const)
    : (['email', 'password'] as const);
  return (
    <AuthLayout>
      <div className="auth-card panel">
        <div className="auth-card-heading">
          <div className="auth-icon">
            <ShieldCheck size={24} />
          </div>
          <p className="eyebrow">YOUR BACKEND, YOUR CONTROL</p>
          <h1>{setup ? 'Set up your workspace' : 'Welcome back'}</h1>
          <p className="muted">
            {setup
              ? 'Create the first platform owner and organization.'
              : 'Sign in to manage your projects.'}
          </p>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {challenge ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await raw('/platform/auth/two-factor/verify-totp', 'POST', { code });
                onDone();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Authenticator code
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <Button type="submit">Verify sign in</Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            {fields.map((name) => (
              <form.Field name={name} key={name}>
                {(field) => (
                  <label>
                    {name === 'bootstrapToken'
                      ? 'Bootstrap token'
                      : name[0].toUpperCase() + name.slice(1)}
                    <input
                      required
                      type={
                        name === 'password' || name === 'bootstrapToken'
                          ? 'password'
                          : name === 'email'
                            ? 'email'
                            : 'text'
                      }
                      minLength={name === 'password' ? 12 : undefined}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      autoComplete={
                        name === 'password'
                          ? setup
                            ? 'new-password'
                            : 'current-password'
                          : name === 'email'
                            ? 'email'
                            : undefined
                      }
                    />
                    {name === 'bootstrapToken' && (
                      <small>Read .data/bootstrap.token on the API host.</small>
                    )}
                  </label>
                )}
              </form.Field>
            ))}
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(pending) => (
                <Button disabled={pending} type="submit" className="full-width">
                  {pending ? 'Please wait…' : setup ? 'Create workspace' : 'Sign in'}
                </Button>
              )}
            </form.Subscribe>
          </form>
        )}
      </div>
      <a href={docsURL + '/docs/getting-started/installation'} className="auth-help">
        <BookOpen size={15} /> Installation and setup guide
      </a>
    </AuthLayout>
  );
}
function Workspace({ user }: { user: any }) {
  const [store] = useState(
    () => new Store({ organization: '', project: '', branch: 'primary', view: 'Overview' }),
  );
  const state = useStore(store);
  const select = (values: Partial<typeof state>) => store.setState((s) => ({ ...s, ...values }));
  const [mobile, setMobile] = useState(false),
    [dialog, setDialog] = useState(false),
    [keyValue, setKeyValue] = useState(''),
    [error, setError] = useState('');
  const cache = useQueryClient();
  const organizations = useQuery({
    queryKey: ['organizations'],
    queryFn: () => management.request<any[]>('/organizations'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => management.request<any[]>('/projects'),
    refetchInterval: (q) =>
      q.state.data?.data.some((p) => p.status === 'provisioning') ? 1000 : false,
  });
  useEffect(() => {
    if (!state.organization && organizations.data?.data[0])
      select({ organization: organizations.data.data[0].id });
  }, [organizations.data]);
  const relevant = projects.data?.data.filter((p) => p.org_id === state.organization) ?? [];
  const project = relevant.find((p) => p.id === state.project);
  useEffect(() => {
    if (!project && relevant[0]) select({ project: relevant[0].id, branch: 'primary' });
  }, [projects.data, state.organization]);
  const branches = useQuery({
    queryKey: ['branches', state.project],
    enabled: !!project && project.status === 'ready',
    queryFn: () => management.request<any[]>(`/projects/${state.project}/branches`),
  });
  const branch = branches.data?.data.find(
    (b) => b.id === state.branch || (state.branch === 'primary' && b.name === 'main'),
  );
  useEffect(() => setKeyValue(''), [state.project]);
  const base = `/projects/${state.project}/branches/${state.branch}`;
  const create = useForm({
    defaultValues: { name: '', slug: '' },
    onSubmit: async ({ value }) => {
      setError('');
      try {
        const result = await management.request('/projects', 'POST', {
          ...value,
          organizationId: state.organization,
          region: 'local',
        });
        select({ project: result.data.id, branch: 'primary' });
        setDialog(false);
        await cache.invalidateQueries({ queryKey: ['projects'] });
      } catch (e) {
        setError((e as Error).message);
      }
    },
  });
  const sidebar = (
    <aside className="studio-sidebar">
      <div className="studio-brand">
        <Brand />
      </div>
      <div className="organization-switch">
        <span className="workspace-avatar">
          {organizations.data?.data.find((o) => o.id === state.organization)?.name?.[0] ?? 'Q'}
        </span>
        <select
          aria-label="Organization"
          value={state.organization}
          onChange={(e) => select({ organization: e.target.value, project: '', branch: 'primary' })}
        >
          {organizations.data?.data.map((o) => (
            <option value={o.id} key={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sidebar-label">PROJECT</div>
      <nav>
        {navigation.map((n) => (
          <button
            key={n.name}
            className={state.view === n.name ? 'selected' : ''}
            onClick={() => {
              select({ view: n.name });
              setMobile(false);
            }}
          >
            <n.icon size={17} />
            <span>{n.name}</span>
            {['Functions', 'AI & Vectors'].includes(n.name) && <small>P1</small>}
          </button>
        ))}
      </nav>
      <div className="studio-sidebar-footer">
        <a href={docsURL}>
          <BookOpen size={16} />
          Documentation
        </a>
        <div className="account">
          <span className="workspace-avatar">{user.name?.[0]}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={async () => {
              await raw('/platform/auth/sign-out', 'POST', {});
              cache.clear();
              location.reload();
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
  return (
    <div className="studio-app">
      <div className="studio-desktop-navigation">{sidebar}</div>
      <Drawer open={mobile} onOpenChange={setMobile} title="Studio navigation">
        {sidebar}
      </Drawer>
      <div className="studio-main">
        <header className="studio-topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Toggle navigation"
            aria-expanded={mobile}
            onClick={() => setMobile((v) => !v)}
          >
            <PanelLeft size={19} />
          </button>
          <Box size={17} />
          <span className="org-crumb">
            {organizations.data?.data.find((o) => o.id === state.organization)?.name}
          </span>
          <ChevronRight size={13} />
          <select
            aria-label="Project"
            value={state.project}
            onChange={(e) => select({ project: e.target.value, branch: 'primary' })}
          >
            <option value="">Select project</option>
            {relevant.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="muted">/</span>
          <GitBranch size={14} />
          <select
            className="branch-select"
            aria-label="Branch"
            value={state.branch}
            onChange={(e) => select({ branch: e.target.value })}
          >
            <option value="primary">main</option>
            {branches.data?.data
              .filter((b) => b.name !== 'main' && b.status === 'ready')
              .map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
          <Badge>
            {branch?.name === 'main' || state.branch === 'primary'
              ? 'Production'
              : 'Restored branch'}
          </Badge>
          <div className="topbar-right">
            <a
              href={
                docsURL +
                '/docs/' +
                ({
                  Overview: 'getting-started/first-project',
                  Database: 'database/schema',
                  Authentication: 'authentication/overview',
                  API: 'database/rest',
                  Realtime: 'realtime/row-events',
                  Storage: 'storage/files',
                  Backups: 'self-hosting/backups',
                  Logs: 'self-hosting/monitoring',
                  Settings: 'authentication/administrator-mfa',
                }[state.view] ?? 'roadmap/phases')
              }
            >
              <BookOpen size={15} /> Help with this workspace
            </a>
          </div>
        </header>
        <main id="main" className="studio-page">
          <div className="page-title">
            <div>
              <p className="eyebrow">
                {project?.name ?? 'WORKSPACE'} / {branch?.name ?? 'MAIN'}
              </p>
              <h1>{state.view === 'Overview' ? 'Project overview' : state.view}</h1>
              <p className="muted">
                {state.view === 'Overview'
                  ? 'Your application, from database to delivery.'
                  : `Manage ${state.view.toLowerCase()} for the selected project.`}
              </p>
            </div>
            <Button onClick={() => setDialog(true)} disabled={!state.organization}>
              <Plus size={16} /> New project
            </Button>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          {!project ? (
            state.view === 'Settings' ? (
              <SettingsWorkspace project={null} organizationId={state.organization} />
            ) : (
              <Empty title="Create your first project">
                A project brings together an isolated database, authentication and APIs. Start by
                creating one above.
              </Empty>
            )
          ) : project.status !== 'ready' ? (
            <Notice>Project is {project.status}. Provisioning runs in the background.</Notice>
          ) : (
            <>
              {state.view === 'Overview' && (
                <Overview project={project} base={base} onNavigate={(view) => select({ view })} />
              )}
              {state.view === 'Database' && <DatabaseWorkspace base={base} />}
              {state.view === 'Authentication' && <AuthWorkspace base={base} project={project} />}
              {state.view === 'API' && (
                <APIWorkspace
                  base={base}
                  project={project}
                  keyValue={keyValue}
                  setKeyValue={setKeyValue}
                />
              )}
              {state.view === 'Storage' && <StorageWorkspace base={base} />}
              {state.view === 'Backups' && <BackupWorkspace base={base} project={project} />}
              {state.view === 'Settings' && (
                <SettingsWorkspace project={project} organizationId={state.organization} />
              )}
              {state.view === 'Logs' && <AuditLog projectId={project.id} />}
              {state.view === 'Realtime' && (
                <div className="panel">
                  <div className="panel-head">
                    <h2>Authorized row events</h2>
                    <Badge>Single node</Badge>
                  </div>
                  <div className="panel-body">
                    <p>
                      Committed changes on exposed tables are available through the application
                      WebSocket endpoint. Subscriptions use the current user's read policies.
                    </p>
                    <pre>{`const channel = qb.channel({\n  table: 'tasks',\n  onEvent: () => refreshTasks(),\n}).subscribe();`}</pre>
                    <a
                      className="button button-secondary"
                      href={docsURL + '/docs/realtime/row-events'}
                    >
                      Read the realtime guide
                    </a>
                  </div>
                </div>
              )}
              {['Functions', 'AI & Vectors'].includes(state.view) && (
                <Empty title="Planned for P1">
                  This capability is not enabled. Its runtime and isolation requirements are
                  documented in the roadmap.
                </Empty>
              )}
            </>
          )}
        </main>
        <AppFooter />
      </div>
      <Modal
        open={dialog}
        onOpenChange={setDialog}
        title="Create a project"
        description="Provision an isolated SQLite database and application realm."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create.handleSubmit();
          }}
        >
          {['name', 'slug'].map((name) => (
            <create.Field key={name} name={name as 'name' | 'slug'}>
              {(field) => (
                <label>
                  {name === 'name' ? 'Project name' : 'Project slug'}
                  <input
                    required
                    value={field.state.value}
                    pattern={name === 'slug' ? '[a-z0-9][a-z0-9-]*' : undefined}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </label>
              )}
            </create.Field>
          ))}
          <label>
            Region
            <input value="Local / single node" disabled />
          </label>
          {error && <Notice kind="error">{error}</Notice>}
          <create.Subscribe selector={(s) => s.isSubmitting}>
            {(pending) => (
              <Button type="submit" disabled={pending}>
                {pending ? 'Provisioning…' : 'Create project'}
              </Button>
            )}
          </create.Subscribe>
        </form>
      </Modal>
    </div>
  );
}
function Overview({
  project,
  base,
  onNavigate,
}: {
  project: any;
  base: string;
  onNavigate: (v: string) => void;
}) {
  const schema = useQuery({
    queryKey: ['schema', base],
    queryFn: () => management.request(base + '/schema'),
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => raw('/ready'),
    refetchInterval: 15000,
  });
  const tables = schema.data?.data.tables ?? [];
  return (
    <div className="stack">
      <div className="metric-grid">
        {[
          {
            label: 'Project status',
            value: project.status,
            detail: 'Persistent project state',
            icon: ShieldCheck,
          },
          {
            label: 'Database tables',
            value: String(tables.length),
            detail: `${tables.filter((t: any) => t.exposed).length} exposed through REST`,
            icon: Database,
          },
          {
            label: 'Schema version',
            value: String(schema.data?.data.schemaVersion ?? '—'),
            detail: 'Versioned schema metadata',
            icon: GitBranch,
          },
          {
            label: 'Active owners',
            value: String(health.data?.owners ?? '—'),
            detail: 'Isolated database workers',
            icon: Box,
          },
        ].map((m) => (
          <section className="metric panel" key={m.label}>
            <div className="metric-label">
              {m.label}
              <m.icon size={16} />
            </div>
            <strong>{m.value}</strong>
            <small>{m.detail}</small>
          </section>
        ))}
      </div>
      <div className="overview-columns">
        <section className="panel">
          <div className="panel-head">
            <h2>Project services</h2>
            <Badge>{health.data?.status ?? 'Connecting'}</Badge>
          </div>
          {[
            { name: 'Database', icon: Database, detail: 'SQLite · WAL · FULL durability' },
            {
              name: 'Authentication',
              icon: ShieldCheck,
              detail: 'Isolated application identities',
            },
            { name: 'Realtime', icon: Zap, detail: 'Committed, policy-filtered row events' },
            { name: 'Storage', icon: HardDrive, detail: 'S3-compatible object gateway' },
          ].map((s) => (
            <button className="service-row" key={s.name} onClick={() => onNavigate(s.name)}>
              <span className="service-icon">
                <s.icon size={20} />
              </span>
              <div>
                <strong>{s.name}</strong>
                <small>{s.detail}</small>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Project details</h2>
          </div>
          <div className="panel-body">
            <dl className="details">
              <dt>Project ID</dt>
              <dd className="mono">{project.id}</dd>
              <dt>Region</dt>
              <dd>{project.region}</dd>
              <dt>Created</dt>
              <dd>{new Date(project.created_at).toLocaleDateString()}</dd>
            </dl>
            <Button variant="secondary" onClick={() => onNavigate('API')}>
              <Code2 size={16} /> Connect application
            </Button>
            <a className="guide-link" href={docsURL + '/docs/getting-started/first-project'}>
              First project tutorial
            </a>
          </div>
        </section>
      </div>
      <AuditLog projectId={project.id} compact />
    </div>
  );
}
export function AuditLog({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const logs = useQuery({
    queryKey: ['audit'],
    queryFn: () => management.request<any[]>('/audit'),
    refetchInterval: 15000,
  });
  const rows = (logs.data?.data ?? [])
    .filter((r) => r.project_id === projectId)
    .slice(0, compact ? 6 : 500);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{compact ? 'Recent activity' : 'Audit events'}</h2>
        <Badge>{rows.length} events</Badge>
      </div>
      {logs.isPending ? (
        <Loading />
      ) : logs.error ? (
        <Notice kind="error">{logs.error.message}</Notice>
      ) : !rows.length ? (
        <Empty title="No recorded events yet" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Resource</th>
                <th>Result</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.action}</td>
                  <td className="mono">{r.resource}</td>
                  <td>{r.result}</td>
                  <td>{new Date(r.time).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
