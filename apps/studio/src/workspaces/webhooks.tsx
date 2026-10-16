import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Empty,
  Loading,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
  toast,
} from '@qb-flex/ui';
import type { TableSchema, WebhookInput, WebhookSummary } from '@qb-flex/contracts';
import { management } from '../api';

export function WebhookWorkspace({ base, projectId }: { base: string; projectId: string }) {
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    name: string;
    action: 'paused' | 'active' | 'revoked' | 'rotate';
  } | null>(null);
  const [form, setForm] = useState({
    name: '',
    url: '',
    serviceKeyId: '',
    table: '',
    columns: '',
    events: 'insert,update,delete',
  });
  const hooks = useQuery({
    queryKey: ['webhooks', base],
    queryFn: ({ signal }) =>
      management.request<WebhookSummary[]>(base + '/webhooks', 'GET', undefined, signal),
    refetchInterval: 15000,
  });
  const schema = useQuery({
    queryKey: ['schema', base],
    queryFn: ({ signal }) =>
      management.request<{ tables: TableSchema[] }>(base + '/schema', 'GET', undefined, signal),
  });
  const keys = useQuery({
    queryKey: ['keys', projectId],
    queryFn: ({ signal }) =>
      management.request<
        { id: string; scope: string; prefix: string; revoked_at: string | null }[]
      >(`/projects/${projectId}/keys`, 'GET', undefined, signal),
  });
  const tables = schema.data?.data.tables.filter((t) => t.exposed) ?? [];
  const write = useMutation({
    gcTime: 0,
    mutationFn: async (action: { create: WebhookInput } | NonNullable<typeof confirm>) => {
      if ('create' in action)
        return management.request<WebhookSummary & { signingSecret?: string }>(
          base + '/webhooks',
          'POST',
          action.create,
        );
      return management.request<WebhookSummary & { signingSecret?: string }>(
        `${base}/webhooks/${action.id}/${action.action === 'rotate' ? 'rotate' : 'state'}`,
        'POST',
        action.action === 'rotate' ? undefined : { state: action.action },
      );
    },
    onSuccess: async (result) => {
      setCreating(false);
      setConfirm(null);
      if (result.data.signingSecret) setSecret(result.data.signingSecret);
      toast.success('Webhook updated');
      write.reset();
    },
  });
  const open = () => {
    write.reset();
    void keys.refetch();
    const table = tables[0];
    setForm({
      name: '',
      url: '',
      serviceKeyId: '',
      table: table?.name ?? '',
      columns: table?.allowedColumns.join(', ') ?? '',
      events: 'insert,update,delete',
    });
    setCreating(true);
  };
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        Experimental database delivery. Configure an active, non-bypass service key and a SELECT
        policy for the service identity. Destinations must use HTTPS. Deliveries are at least once:
        receivers must deduplicate event IDs. No recovery, email-alert or push service is implied.
        <Link to="/jobs" className="ml-2 underline underline-offset-4">
          Inspect attempts in Job Inbox
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          Up to 20 subscriptions per branch · refreshes every 15 seconds
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void hooks.refetch();
              void keys.refetch();
            }}
            disabled={hooks.isFetching}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
          <Button onClick={open} disabled={!tables.length}>
            <Plus aria-hidden="true" className="size-4" />
            New webhook
          </Button>
        </div>
      </div>
      {hooks.error && (
        <p role="alert" className="text-sm text-destructive">
          {hooks.error.message}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {hooks.isPending ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : !hooks.data?.data.length ? (
          <div className="p-8">
            <Empty title="No webhooks configured">
              Expose a table, configure a scoped integration key, then create a subscription.
              Creation starts with future commits only.
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subscription</TableHead>
                <TableHead>Projection</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Checkpoint</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks.data.data.map((hook) => (
                <TableRow key={hook.id}>
                  <TableCell>
                    <span className="block font-medium">{hook.name}</span>
                    <span className="block max-w-64 truncate text-xs text-muted-foreground">
                      {hook.destinationOrigin}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block font-mono text-xs">{hook.table}</span>
                    <span className="block max-w-64 truncate text-xs text-muted-foreground">
                      {hook.columns.join(', ')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge>{hook.state}</Badge>
                    {hook.rotationUntil && (
                      <span className="block text-xs text-muted-foreground">
                        Rotation overlap active
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {hook.checkpoint}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {hook.state !== 'revoked' && (
                        <>
                          {['active', 'paused'].includes(hook.state) && (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                write.reset();
                                setConfirm({
                                  id: hook.id,
                                  name: hook.name,
                                  action: hook.state === 'active' ? 'paused' : 'active',
                                });
                              }}
                            >
                              {hook.state === 'active' ? 'Pause' : 'Resume'}
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            disabled={!!hook.rotationUntil}
                            onClick={() => {
                              write.reset();
                              setConfirm({ id: hook.id, name: hook.name, action: 'rotate' });
                            }}
                          >
                            Rotate secret
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              write.reset();
                              setConfirm({ id: hook.id, name: hook.name, action: 'revoked' });
                            }}
                          >
                            Revoke
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <Dialog
        open={creating}
        onOpenChange={(value) => {
          if (!write.isPending) setCreating(value);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>New webhook</DialogTitle>
          <DialogDescription>
            Administrator-authorized write. The service key must grant GET to this immutable branch
            and table without policy bypass.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              write.mutate({
                create: {
                  ...form,
                  columns: form.columns
                    .split(',')
                    .map((c) => c.trim())
                    .filter(Boolean),
                  events: form.events
                    .split(',')
                    .map((e) => e.trim())
                    .filter(Boolean) as WebhookInput['events'],
                },
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="hook-name">Name</Label>
              <Input
                id="hook-name"
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-url">HTTPS destination</Label>
              <Input
                id="hook-url"
                type="url"
                required
                maxLength={2048}
                placeholder="https://your-receiver.example/events"
                value={form.url}
                onChange={(e) => setForm((v) => ({ ...v, url: e.target.value }))}
              />
              <p className="m-0 text-xs text-muted-foreground">
                No credentials, query strings, fragments or redirects. Private networks require
                operator configuration.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-key">Integration service key</Label>
              <Select
                value={form.serviceKeyId}
                onValueChange={(value) => setForm((v) => ({ ...v, serviceKeyId: value }))}
              >
                <SelectTrigger id="hook-key">
                  <SelectValue placeholder="Select a scoped service key" />
                </SelectTrigger>
                <SelectContent>
                  {keys.data?.data
                    .filter((key) => key.scope === 'service' && !key.revoked_at)
                    .map((key) => (
                      <SelectItem key={key.id} value={key.id}>
                        {key.prefix} · {key.id.slice(0, 8)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {keys.error && <p role="alert">{keys.error.message}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-table">Exposed table</Label>
              <Select
                value={form.table}
                onValueChange={(value) =>
                  setForm((v) => ({
                    ...v,
                    table: value,
                    columns: tables.find((t) => t.name === value)?.allowedColumns.join(', ') ?? '',
                  }))
                }
              >
                <SelectTrigger id="hook-table">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-columns">Allowed columns (comma-separated)</Label>
              <Input
                id="hook-columns"
                required
                value={form.columns}
                onChange={(e) => setForm((v) => ({ ...v, columns: e.target.value }))}
              />
              <p className="m-0 text-xs text-muted-foreground">
                Include every primary key. Hidden columns are rejected.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-events">Events (insert, update, delete)</Label>
              <Input
                id="hook-events"
                required
                value={form.events}
                onChange={(e) => setForm((v) => ({ ...v, events: e.target.value }))}
              />
            </div>
            {write.error && (
              <p role="alert" className="text-sm text-destructive">
                {write.error.message}
              </p>
            )}
            <Button type="submit" disabled={write.isPending || !form.serviceKeyId || !form.table}>
              {write.isPending ? 'Creating…' : 'Create subscription'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !write.isPending) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm webhook change</DialogTitle>
          <DialogDescription>
            {confirm?.action === 'rotate'
              ? 'Save the new secret securely. Both signatures remain valid for 24 hours; another rotation is blocked during this overlap.'
              : confirm?.action === 'revoked'
                ? 'Revocation is permanent and prevents future dispatch. It cannot undo an in-flight request.'
                : 'Pause or resume future dispatch. Replay gaps require reconciliation and a new subscription.'}
          </DialogDescription>
          <p className="text-sm">
            {confirm?.name} · {confirm?.action}
          </p>
          {write.error && (
            <p role="alert" className="text-destructive">
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
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!secret}
        onOpenChange={(open) => {
          if (!open) setSecret(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Save your signing secret</DialogTitle>
          <DialogDescription>
            This secret is shown only now. Store it on your receiver, never in browser code. Closing
            this dialog clears it from this view.
          </DialogDescription>
          <Label htmlFor="hook-secret">Signing secret</Label>
          <Input
            id="hook-secret"
            type="password"
            readOnly
            autoComplete="off"
            value={secret ?? ''}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret!);
                  toast.success('Secret copied');
                } catch {
                  toast.error('Clipboard unavailable');
                }
              }}
            >
              Copy secret
            </Button>
            <Button onClick={() => setSecret(null)}>I saved it</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
