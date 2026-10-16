import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Empty,
  Loading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@qb-flex/ui';
import type { JobSummary, JobAttempt } from '@qb-flex/contracts';
import { management } from '../api';

export function JobInbox({ base }: { base: string }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    job: JobSummary;
    action: 'cancel' | 'replay';
    key: string;
  } | null>(null);
  const cursor = cursors.at(-1);
  const jobs = useQuery({
    queryKey: ['jobs', base, cursor],
    queryFn: ({ signal }) =>
      management.request<JobSummary[]>(
        base + '/jobs?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        'GET',
        undefined,
        signal,
      ),
    refetchInterval: 15000,
  });
  const detail = useQuery({
    queryKey: ['job', base, selected],
    enabled: !!selected,
    queryFn: ({ signal }) =>
      management.request<JobSummary & { history: JobAttempt[] }>(
        `${base}/jobs/${encodeURIComponent(selected!)}`,
        'GET',
        undefined,
        signal,
      ),
  });
  const write = useMutation({
    mutationFn: (operation: NonNullable<typeof confirm>) =>
      management.request<JobSummary>(
        `${base}/jobs/${encodeURIComponent(operation.job.id)}/${operation.action}`,
        'POST',
        undefined,
        undefined,
        operation.action === 'replay' ? { 'idempotency-key': operation.key } : undefined,
      ),
    onSuccess: async () => {
      setConfirm(null);
      toast.success('Job updated');
    },
  });
  const rows = jobs.data?.data ?? [];
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Experimental owner foundation. Payloads and lease credentials are never shown here. Scoped
        database webhooks can produce jobs; alert and push integrations remain under development.
        Delivery can be duplicated; replay requires receiver deduplication. Administrator permission
        is required for writes.
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} jobs on this page · refreshes every 15 seconds
        </p>
        <Button variant="secondary" onClick={() => void jobs.refetch()} disabled={jobs.isFetching}>
          <RefreshCw aria-hidden="true" className="size-4" /> Refresh
        </Button>
      </div>
      {jobs.error && (
        <p role="alert" className="text-sm text-destructive">
          {jobs.error.message}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {jobs.isPending ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : !rows.length ? (
          <div className="p-8">
            <Empty title="No jobs yet">
              Jobs appear when configured owner workflows submit durable work.
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <button
                      onClick={() => setSelected(job.id)}
                      className="rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="block font-medium">{job.kind}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {job.id.slice(0, 12)}
                      </span>
                      <span className="sr-only">View job details for {job.id}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge>{job.state}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {job.attempts}/{job.maxAttempts}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {!['dead', 'cancelled', 'succeeded'].includes(job.state) && (
                        <Button
                          variant="secondary"
                          disabled={write.isPending}
                          onClick={() => {
                            write.reset();
                            setConfirm({ job, action: 'cancel', key: crypto.randomUUID() });
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                      {job.state === 'dead' && !job.kind.startsWith('push.') && (
                        <Button
                          variant="secondary"
                          disabled={write.isPending}
                          onClick={() => {
                            write.reset();
                            setConfirm({ job, action: 'replay', key: crypto.randomUUID() });
                          }}
                        >
                          Replay
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={cursors.length === 1 || jobs.isFetching}
          onClick={() => setCursors((values) => values.slice(0, -1))}
        >
          Previous page
        </Button>
        <Button
          variant="secondary"
          disabled={!jobs.data?.meta.cursor || jobs.isFetching}
          onClick={() => setCursors((values) => [...values, jobs.data!.meta.cursor])}
        >
          Next page
        </Button>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>Job attempt history</DialogTitle>
          <DialogDescription>
            Metadata only. A successful executor result does not prove external delivery or reading.
          </DialogDescription>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <p role="alert">{detail.error.message}</p>
          ) : (
            detail.data && (
              <div className="grid gap-3 text-sm">
                <p className="break-all font-mono text-xs">{detail.data.data.id}</p>
                <p>
                  {detail.data.data.kind} · {detail.data.data.state}
                </p>
                <p className="text-muted-foreground">
                  Diagnostic: {detail.data.data.lastCode ?? 'None'}
                </p>
                {detail.data.data.parentId && (
                  <p className="break-all text-xs">Replayed from {detail.data.data.parentId}</p>
                )}
                <ol className="grid gap-2">
                  {detail.data.data.history.map((attempt) => (
                    <li key={attempt.attempt} className="rounded-lg border border-border p-3">
                      Attempt {attempt.attempt}: {attempt.outcome}
                      <span className="block text-xs text-muted-foreground">
                        {attempt.code ?? 'No diagnostic code'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !write.isPending) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {confirm?.action === 'replay' ? 'Replay dead-letter job?' : 'Cancel unsent job work?'}
          </DialogTitle>
          <DialogDescription>
            {confirm?.action === 'replay'
              ? 'Replay creates a new job with the same event identity. It can duplicate an external effect. Verify receiver deduplication before continuing.'
              : 'Cancellation fences further completion, but cannot undo an external effect already accepted by a provider.'}
          </DialogDescription>
          <p className="break-all font-mono text-xs text-muted-foreground">{confirm?.job.id}</p>
          {write.error && (
            <p role="alert" className="text-sm text-destructive">
              {write.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={write.isPending} onClick={() => setConfirm(null)}>
              Keep unchanged
            </Button>
            <Button
              disabled={write.isPending || !confirm}
              onClick={() => {
                if (confirm) write.mutate(confirm);
              }}
            >
              {write.isPending ? 'Updating…' : 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
