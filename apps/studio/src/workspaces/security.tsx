import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Empty,
  Loading,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@qb-flex/ui';
import type { SecurityFinding, SecurityReport } from '@qb-flex/contracts';
import { management } from '../api';

export function SecurityWorkspace({ base }: { base: string }) {
  const [selection, setSelection] = useState<SecurityFinding | null>(null);
  const [days, setDays] = useState('7');
  const scan = useQuery({
    queryKey: ['security', base],
    queryFn: ({ signal }) =>
      management.request<SecurityReport>(base + '/security', 'GET', undefined, signal),
  });
  const write = useMutation({
    mutationFn: (input: { id: string; expiresAt?: number }) =>
      management.request(
        `${base}/security/${input.id}/acknowledge`,
        input.expiresAt ? 'POST' : 'DELETE',
        input.expiresAt ? { expiresAt: input.expiresAt } : undefined,
      ),
    onSuccess: async () => {
      setSelection(null);
      toast.success('Acknowledgment updated');
    },
  });
  const report = scan.data?.data,
    findings = report?.findings ?? [];
  const active = findings.filter((f) => !f.acknowledgedUntil);
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        Experimental, bounded static checks—not a security audit. Findings never change policies or
        production data. Acknowledgments expire and do not resolve risk.
        <Link to="/database" className="ml-2 underline underline-offset-4">
          Review policies in Database
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['high', 'medium', 'info'] as const).map((severity) => (
          <div key={severity} className="rounded-xl border border-border bg-card p-4">
            <p className="m-0 text-xs text-muted-foreground capitalize">
              {severity} · unacknowledged
            </p>
            <p className="mb-0 mt-2 text-2xl font-semibold tabular-nums">
              {active.filter((f) => f.severity === severity).length}
            </p>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="m-0 text-xs text-muted-foreground">Acknowledged</p>
          <p className="mb-0 mt-2 text-2xl font-semibold tabular-nums">
            {findings.length - active.length}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-xs text-muted-foreground">
          {report
            ? `Scanned ${new Date(report.scannedAt).toLocaleString()} · schema v${report.schemaVersion}`
            : 'Waiting for scan'}
        </p>
        <Button variant="secondary" disabled={scan.isFetching} onClick={() => void scan.refetch()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Run scan
        </Button>
      </div>
      {scan.error && (
        <p role="alert" className="text-sm text-destructive">
          {scan.error.message}
        </p>
      )}
      {report?.truncated && (
        <p role="alert" className="rounded-lg border border-border p-3 text-sm">
          Scan limits were reached. This report is incomplete; review the remaining inventory
          separately.
        </p>
      )}
      {scan.isPending ? (
        <Loading />
      ) : !findings.length ? (
        <div className="rounded-xl border border-border bg-card p-8">
          <Empty title="No findings in this scan">
            This is not proof that the installation is secure. Continue testing actual policies and
            reviewing credentials.
          </Empty>
        </div>
      ) : (
        <div className="grid gap-3">
          {findings.map((finding) => (
            <article key={finding.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{finding.severity}</Badge>
                    <h2 className="m-0 text-sm font-semibold">
                      {finding.code.replaceAll('_', ' ')}
                    </h2>
                    {finding.acknowledgedUntil && <Badge>Acknowledged</Badge>}
                  </div>
                  <p className="mb-0 mt-2 break-all font-mono text-xs text-muted-foreground">
                    {finding.resource}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={write.isPending}
                  onClick={() => {
                    write.reset();
                    setDays('7');
                    setSelection(finding);
                  }}
                >
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  {finding.acknowledgedUntil ? 'Clear acknowledgment' : 'Acknowledge'}
                </Button>
              </div>
              <ul className="my-3 grid gap-1 pl-5 text-sm text-muted-foreground">
                {finding.evidence.map((line, index) => (
                  <li className="break-words" key={index}>
                    {line}
                  </li>
                ))}
              </ul>
              <p className="m-0 text-sm leading-relaxed">{finding.remediation}</p>
              {finding.acknowledgedUntil && (
                <p className="mb-0 mt-3 text-xs text-muted-foreground">
                  Acknowledgment expires {new Date(finding.acknowledgedUntil).toLocaleString()}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {report && (
        <ul className="m-0 grid gap-1 pl-5 text-xs text-muted-foreground">
          {report.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!selection}
        onOpenChange={(open) => {
          if (!open && !write.isPending) setSelection(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {selection?.acknowledgedUntil ? 'Clear acknowledgment?' : 'Acknowledge finding?'}
          </DialogTitle>
          <DialogDescription>
            This records a reviewed risk, not a fix. Changed evidence creates a new finding and
            cannot inherit this acknowledgment. Administrator permission is required.
          </DialogDescription>
          <p className="text-sm">
            {selection?.code} · {selection?.resource}
          </p>
          {!selection?.acknowledgedUntil && (
            <div className="grid gap-2">
              <Label htmlFor="ack-duration">Acknowledgment duration</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger id="ack-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['1', '7', '30'].map((day) => (
                    <SelectItem key={day} value={day}>
                      {day} {day === '1' ? 'day' : 'days'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {write.error && (
            <p role="alert" className="text-sm text-destructive">
              {write.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={write.isPending}
              onClick={() => setSelection(null)}
            >
              Keep unchanged
            </Button>
            <Button
              disabled={write.isPending || !selection}
              onClick={() => {
                if (selection)
                  write.mutate({
                    id: selection.id,
                    ...(selection.acknowledgedUntil
                      ? {}
                      : { expiresAt: Date.now() + Number(days) * 86400000 }),
                  });
              }}
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
