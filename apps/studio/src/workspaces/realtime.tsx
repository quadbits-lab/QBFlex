import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  Field,
  FieldLabel,
  Input,
  Loading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShadcnButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@qb-flex/ui';
import type { RealtimeDebugSession } from '@qb-flex/contracts';
import { docsURL, management } from '../api';

export function RealtimeWorkspace({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}) {
  const api = management.realtimeDebug(projectId, branchId);
  const [sub, setSub] = useState('');
  const [role, setRole] = useState('authenticated');
  const [active, setActive] = useState<RealtimeDebugSession | null>(null);
  const sessions = useQuery({
    queryKey: ['realtime-debug', projectId, branchId],
    queryFn: ({ signal }) => api.list(signal),
  });
  const open = useMutation({
    mutationFn: () =>
      api.open({
        identitySub: role === 'anonymous' ? null : sub.trim(),
        identityRole: role,
      }),
    onSuccess: (result) => {
      setActive(result.data);
      toast.success('Debug session opened');
    },
  });
  const rows = sessions.data?.data ?? [];
  const shown = active ?? rows[0] ?? null;
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        Debug sessions record connection metadata for an application identity: state, table, latency
        and replay gap. They do not capture row bodies, credentials or URLs. A management session
        is not proof that this identity can read a table.
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Open debug session</CardTitle>
          <CardDescription>
            Use the application user subject and role you want to trace. Anonymous sessions have no
            subject.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              open.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="debug-role">Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => {
                  setRole(value);
                  if (value === 'anonymous') setSub('');
                }}
              >
                <SelectTrigger id="debug-role" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="authenticated">authenticated</SelectItem>
                  <SelectItem value="anonymous">anonymous</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field className="min-w-56 flex-1">
              <FieldLabel htmlFor="debug-sub">Application subject</FieldLabel>
              <Input
                id="debug-sub"
                value={sub}
                disabled={role === 'anonymous'}
                maxLength={200}
                onChange={(event) => setSub(event.target.value)}
                placeholder="user id"
                required={role !== 'anonymous'}
              />
            </Field>
            <Button type="submit" disabled={open.isPending || (role !== 'anonymous' && !sub.trim())}>
              {open.isPending ? 'Opening…' : 'Open session'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={sessions.isFetching}
              onClick={() => void sessions.refetch()}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          </form>
          {open.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {open.error.message}
            </p>
          )}
          {sessions.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {sessions.error.message}
            </p>
          )}
        </CardContent>
      </Card>
      {sessions.isPending ? (
        <Loading />
      ) : !shown ? (
        <div className="rounded-xl border border-border bg-card p-8">
          <Empty title="No debug sessions">Open a session for an application identity.</Empty>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Trace</CardTitle>
              <Badge variant="outline">{shown.identityRole}</Badge>
            </div>
            <CardDescription>
              {shown.identitySub ?? 'anonymous'} · opened{' '}
              {new Date(shown.createdAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {rows.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {rows.map((session) => (
                  <Button
                    key={session.id}
                    variant={session.id === shown.id ? 'primary' : 'secondary'}
                    onClick={() => setActive(session)}
                  >
                    {(session.identitySub ?? 'anonymous').slice(0, 12)}
                  </Button>
                ))}
              </div>
            )}
            {!shown.entries.length ? (
              <p className="m-0 text-sm text-muted-foreground">No trace entries yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Gap</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.entries.map((entry, index) => (
                    <TableRow key={`${entry.at}-${index}`}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(entry.at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.state}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.table ?? '—'}</TableCell>
                      <TableCell className="tabular-nums">
                        {entry.latencyMs === null ? '—' : `${entry.latencyMs} ms`}
                      </TableCell>
                      <TableCell className="tabular-nums">{entry.gap ?? '—'}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs">{entry.detail ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          <CardFooter>
            <ShadcnButton variant="outline" asChild>
              <a href={docsURL + '/docs/realtime/row-events'}>
                Read the realtime guide
                <ArrowUpRight data-icon="inline-end" />
              </a>
            </ShadcnButton>
          </CardFooter>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Subscribe from the application</CardTitle>
          <CardDescription>
            Application code uses the JavaScript SDK. This debugger does not open that socket for
            you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="m-0 overflow-auto font-mono text-xs">{`const channel = qb.channel({\n  table: 'tasks',\n  onEvent: () => refreshTasks(),\n}).subscribe();\n\nchannel.unsubscribe();`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
