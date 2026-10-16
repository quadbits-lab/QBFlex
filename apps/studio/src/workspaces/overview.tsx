import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Database,
  GitBranch,
  Code2,
  Users,
  HardDrive,
  ArrowUpRight,
  ShieldCheck,
  Activity,
  KeyRound,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Skeleton,
  ShadcnButton as Button,
  Separator,
  toast,
} from '@qb-flex/ui';
import { ErrorMessage } from './shared';
import { management, docsURL, raw } from '../api';
import { AuditLog } from './audit';

export function Overview({ project, base }: { project: any; base: string }) {
  const schema = useQuery({
    queryKey: ['schema', base],
    queryFn: () => management.request<any>(base + '/schema'),
  });
  const branches = useQuery({
    queryKey: ['branches', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/branches`),
  });
  const keys = useQuery({
    queryKey: ['keys', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/keys`),
  });
  const users = useQuery({
    queryKey: ['users', base],
    queryFn: () => management.request<any[]>(base + '/users'),
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => raw('/ready'),
    refetchInterval: 15000,
  });
  const tables = schema.data?.data.tables ?? [];
  const exposed = tables.filter((t: any) => t.exposed).length;
  const metrics = [
    {
      label: 'Database tables',
      value: schema.data ? tables.length : '—',
      detail: `${exposed} exposed through REST`,
      icon: Database,
      path: '/database',
      pending: schema.isPending,
    },
    {
      label: 'Application users',
      value: users.data?.data.length ?? '—',
      detail: 'Identities in this branch',
      icon: Users,
      path: '/auth',
      pending: users.isPending,
    },
    {
      label: 'Branches',
      value: branches.data?.data.length ?? '—',
      detail: `Schema version ${schema.data?.data.schemaVersion ?? '—'}`,
      icon: GitBranch,
      path: '/backups',
      pending: branches.isPending,
    },
    {
      label: 'Active API keys',
      value: keys.data ? keys.data.data.filter((k: any) => !k.revoked_at).length : '—',
      detail: 'Project access credentials',
      icon: KeyRound,
      path: '/api',
      pending: keys.isPending,
    },
  ];
  const services = [
    {
      name: 'Database',
      icon: Database,
      detail: 'Browse data, manage policies, and run SQL.',
      path: '/database',
    },
    {
      name: 'Schema visualizer',
      icon: GitBranch,
      detail: 'Explore tables and their relationships.',
      path: '/schema',
    },
    {
      name: 'Authentication',
      icon: Users,
      detail: 'Manage users and sign-in providers.',
      path: '/auth',
    },
    {
      name: 'Storage',
      icon: HardDrive,
      detail: 'Upload and organize your application files.',
      path: '/storage',
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <CardTitle>Ready to build, {project.name}.</CardTitle>
            <CardDescription>
              Your database, access controls, and delivery tools in one workspace.
            </CardDescription>
          </div>
          <Badge variant={health.error ? 'warning' : health.data ? 'success' : 'outline'}>
            <Activity className="size-3" aria-hidden="true" />
            {health.error ? 'API unavailable' : (health.data?.status ?? 'Checking API')}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Project {project.status}
            </span>
            <span>{project.region}</span>
            <span>{health.data?.owners ?? '—'} active database owners</span>
            <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button asChild>
            <Link to="/api">
              <Code2 data-icon="inline-start" />
              Connect your application
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/database">
              Open database
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
      <div className="grid grid-cols-1 min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardDescription>{m.label}</CardDescription>
              <m.icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {m.pending ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <p className="m-0 text-3xl font-semibold tracking-tight tabular-nums">{m.value}</p>
              )}
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <span className="text-xs text-muted-foreground">{m.detail}</span>
              <Button variant="ghost" size="icon" aria-label={'Open ' + m.label} asChild>
                <Link to={m.path}>
                  <ArrowUpRight />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      {[schema.error, branches.error, keys.error, users.error].filter(Boolean).map((error, i) => (
        <ErrorMessage key={i} error={error as Error} />
      ))}
      <div className="grid grid-cols-1 min-w-0 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Build your backend</CardTitle>
            <CardDescription>Pick up where you left off.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {services.map((s) => (
              <Link
                to={s.path}
                key={s.path}
                className="group flex min-w-0 flex-col gap-3 rounded-lg border bg-background/40 p-4 transition-colors hover:bg-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="grid grid-cols-1 size-9 place-items-center rounded-md border bg-card">
                    <s.icon className="size-4" aria-hidden="true" />
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.detail}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Access & configuration</CardTitle>
            <CardDescription>Review how your application connects.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Project ID</dt>
              <dd className="m-0 break-all font-mono text-xs">{project.id}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="m-0 truncate font-mono text-xs">{project.slug}</dd>
              <dt className="text-muted-foreground">REST access</dt>
              <dd className="m-0">
                {exposed} of {tables.length} tables exposed
              </dd>
            </dl>
            <Separator />
            <p className="m-0 text-xs text-muted-foreground">
              Tables stay private until exposed. Row policies determine which records your users can
              read and change.
            </p>
          </CardContent>
          <CardFooter className="flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/settings">Project settings</Link>
            </Button>
            <Button variant="ghost" asChild>
              <a href={docsURL + '/docs/getting-started/first-project'}>
                Quickstart
                <ArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          </CardFooter>
        </Card>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight">Activity</h2>
          <p className="m-0 text-sm text-muted-foreground">
            Interactive charts and recent audit events from this project.
          </p>
        </div>
        <AuditLog projectId={project.id} compact />
      </div>
    </div>
  );
}
