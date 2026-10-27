import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@qb-flex/ui';
import type { PreviewInput, PreviewState } from '@qb-flex/contracts';
import { management } from '../api';

const TTL_OPTIONS = ['24', '72', '168'] as const;

export function PreviewsWorkspace({ projectId }: { projectId: string }) {
  const api = management.previews(projectId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [ttlHours, setTtlHours] = useState<(typeof TTL_OPTIONS)[number]>('72');
  const [fixtures, setFixtures] = useState('');
  const [extendId, setExtendId] = useState<string | null>(null);
  const [extendHours, setExtendHours] = useState<(typeof TTL_OPTIONS)[number]>('72');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const previews = useQuery({
    queryKey: ['previews', projectId],
    queryFn: ({ signal }) => api.list(signal),
    refetchInterval: 15000,
  });
  const create = useMutation({
    mutationFn: () => {
      const input: PreviewInput = { ttlHours: Number(ttlHours) };
      const trimmed = name.trim();
      if (trimmed) input.name = trimmed;
      if (fixtures.trim()) {
        const parsed: unknown = JSON.parse(fixtures);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Fixtures must be an object of table names to row arrays');
        }
        input.fixtures = parsed as PreviewInput['fixtures'];
      }
      return api.create(input);
    },
    onSuccess: () => {
      setCreating(false);
      setName('');
      setFixtures('');
      toast.success('Preview requested');
    },
  });
  const extend = useMutation({
    mutationFn: () => api.extend(extendId!, Number(extendHours)),
    onSuccess: () => {
      setExtendId(null);
      toast.success('Preview TTL extended');
    },
  });
  const remove = useMutation({
    mutationFn: () => api.remove(removeId!),
    onSuccess: () => {
      setRemoveId(null);
      toast.success('Preview delete requested');
    },
  });
  const rows = previews.data?.data ?? [];
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        A preview copies schema, exposure, relationships and policies into a disposable branch. It
        does not copy rows, users, sessions, provider credentials or webhook destinations. Optional
        fixtures are synthetic rows you type here. Default TTL is 72 hours and the maximum is 7
        days. Previews are not merged back to primary.
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">Refreshes every 15 seconds</p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={previews.isFetching}
            onClick={() => void previews.refetch()}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
          <Button
            onClick={() => {
              create.reset();
              setCreating(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            New preview
          </Button>
        </div>
      </div>
      {previews.error && (
        <p role="alert" className="text-sm text-destructive">
          {previews.error.message}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {previews.isPending ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : !rows.length ? (
          <div className="p-8">
            <Empty title="No previews">Create a disposable schema fork for this project.</Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preview</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((preview) => (
                <TableRow key={preview.id}>
                  <TableCell>
                    <span className="block font-medium">{preview.name || preview.id.slice(0, 8)}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{preview.id}</span>
                  </TableCell>
                  <TableCell>
                    <PreviewBadge state={preview.state} />
                    {preview.error && (
                      <span className="mt-1 block max-w-64 text-xs text-destructive">{preview.error}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(preview.expiresAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {preview.state !== 'deleted' && preview.state !== 'deleting' && (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              extend.reset();
                              setExtendHours('72');
                              setExtendId(preview.id);
                            }}
                          >
                            Extend
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              remove.reset();
                              setRemoveId(preview.id);
                            }}
                          >
                            Delete
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
      <Dialog open={creating} onOpenChange={(open) => !create.isPending && setCreating(open)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>New preview</DialogTitle>
          <DialogDescription>
            Provisioning is asynchronous. An empty fixture object copies no rows.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="preview-name">Name</FieldLabel>
              <Input
                id="preview-name"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="schema-fork"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-ttl">TTL</FieldLabel>
              <Select
                value={ttlHours}
                onValueChange={(value) => setTtlHours(value as (typeof TTL_OPTIONS)[number])}
              >
                <SelectTrigger id="preview-ttl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="72">72 hours</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-fixtures">Synthetic fixtures JSON</FieldLabel>
              <Textarea
                id="preview-fixtures"
                className="min-h-32 font-mono text-xs"
                value={fixtures}
                onChange={(event) => setFixtures(event.target.value)}
                placeholder='{"tasks":[{"title":"Example"}]}'
                spellCheck={false}
              />
            </Field>
            {create.error && (
              <p role="alert" className="text-sm text-destructive">
                {create.error.message}
              </p>
            )}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create preview'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!extendId} onOpenChange={(open) => !extend.isPending && !open && setExtendId(null)}>
        <DialogContent>
          <DialogTitle>Extend preview</DialogTitle>
          <DialogDescription>TTL must stay between 1 and 168 hours from now.</DialogDescription>
          <Select
            value={extendHours}
            onValueChange={(value) => setExtendHours(value as (typeof TTL_OPTIONS)[number])}
          >
            <SelectTrigger aria-label="Extension">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24 hours</SelectItem>
              <SelectItem value="72">72 hours</SelectItem>
              <SelectItem value="168">7 days</SelectItem>
            </SelectContent>
          </Select>
          {extend.error && (
            <p role="alert" className="text-sm text-destructive">
              {extend.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={extend.isPending} onClick={() => setExtendId(null)}>
              Cancel
            </Button>
            <Button disabled={extend.isPending} onClick={() => extend.mutate()}>
              Extend
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!removeId} onOpenChange={(open) => !remove.isPending && !open && setRemoveId(null)}>
        <DialogContent>
          <DialogTitle>Delete preview</DialogTitle>
          <DialogDescription>
            Deletion removes the disposable branch. It does not change the primary branch.
          </DialogDescription>
          {remove.error && (
            <p role="alert" className="text-sm text-destructive">
              {remove.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={remove.isPending} onClick={() => setRemoveId(null)}>
              Keep preview
            </Button>
            <Button disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewBadge({ state }: { state: PreviewState }) {
  const variant = state === 'failed' || state === 'expiring' ? 'warning' : 'outline';
  return <Badge variant={variant}>{state}</Badge>;
}
