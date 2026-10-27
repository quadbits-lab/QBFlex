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
} from '@qb-flex/ui';
import type { QueryPlanResult } from '@qb-flex/contracts';
import { management } from '../api';

export function InspectorWorkspace({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}) {
  const api = management.inspector(projectId, branchId);
  const [plan, setPlan] = useState<QueryPlanResult | null>(null);
  const samples = useQuery({
    queryKey: ['inspector', projectId, branchId],
    queryFn: ({ signal }) => api.samples(signal),
  });
  const explain = useMutation({
    mutationFn: (fingerprint: string) => api.plan(fingerprint),
    onSuccess: (result) => setPlan(result.data),
  });
  const rows = samples.data?.data ?? [];
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        Samples are normalized SELECT fingerprints recorded by the branch owner. Plans run EXPLAIN
        on the stored generated statement. Parameter values are not kept. Suggestions never create
        indexes.
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">Up to 200 samples</p>
        <Button variant="secondary" disabled={samples.isFetching} onClick={() => void samples.refetch()}>
          <RefreshCw aria-hidden="true" className="size-4" />
          Refresh
        </Button>
      </div>
      {samples.error && (
        <p role="alert" className="text-sm text-destructive">
          {samples.error.message}
        </p>
      )}
      {explain.error && (
        <p role="alert" className="text-sm text-destructive">
          {explain.error.message}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {samples.isPending ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : !rows.length ? (
          <div className="p-8">
            <Empty title="No query samples">
              Slow generated SELECT statements appear here after the branch records them.
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fingerprint</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Hits</TableHead>
                <TableHead>Sampled</TableHead>
                <TableHead>Plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((sample) => (
                <TableRow key={sample.id}>
                  <TableCell>
                    <span className="block max-w-80 truncate font-mono text-xs" title={sample.fingerprint}>
                      {sample.fingerprint}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{sample.table}</TableCell>
                  <TableCell className="tabular-nums">{sample.durationMs} ms</TableCell>
                  <TableCell className="tabular-nums">{sample.count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(sample.sampledAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="secondary"
                      disabled={explain.isPending}
                      onClick={() => {
                        setPlan(null);
                        explain.mutate(sample.fingerprint);
                      }}
                    >
                      Plan
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <Dialog open={!!plan} onOpenChange={(open) => !open && setPlan(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>Query plan</DialogTitle>
          <DialogDescription>
            Diagnostic EXPLAIN output for fingerprint {plan?.fingerprint}. State {plan?.state}.
          </DialogDescription>
          {plan?.error && (
            <p role="alert" className="text-sm text-destructive">
              {plan.error}
            </p>
          )}
          {plan && (
            <div className="grid gap-3">
              <Badge variant={plan.state === 'failed' ? 'warning' : 'outline'}>{plan.state}</Badge>
              {plan.suggestions.length > 0 && (
                <ul className="m-0 grid gap-2 pl-5 text-sm">
                  {plan.suggestions.map((suggestion) => (
                    <li key={`${suggestion.table}:${suggestion.columns.join(',')}`}>
                      <span className="font-mono text-xs">
                        {suggestion.table} ({suggestion.columns.join(', ')})
                      </span>
                      <span className="mt-1 block text-muted-foreground">{suggestion.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              <pre className="m-0 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                {JSON.stringify(plan.plan, null, 2)}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
