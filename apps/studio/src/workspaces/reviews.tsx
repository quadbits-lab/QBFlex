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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@qb-flex/ui';
import type { ReviewState, SchemaReviewDetail, SchemaReviewSummary } from '@qb-flex/contracts';
import { management } from '../api';

const rehearseStates: ReviewState[] = ['draft', 'rehearsed', 'stale'];

export function ReviewsWorkspace({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}) {
  const api = management.reviews(projectId, branchId);
  const [creating, setCreating] = useState(false);
  const [migrationId, setMigrationId] = useState('');
  const [sql, setSql] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const reviews = useQuery({
    queryKey: ['reviews', projectId, branchId],
    queryFn: ({ signal }) => api.list(signal),
  });
  const detail = useQuery({
    queryKey: ['review', projectId, branchId, selected],
    enabled: !!selected,
    queryFn: ({ signal }) => api.get(selected!, signal),
  });
  const create = useMutation({
    mutationFn: () => api.create({ migrationId: migrationId.trim(), sql }),
    onSuccess: () => {
      setCreating(false);
      setMigrationId('');
      setSql('');
      toast.success('Schema review drafted');
    },
  });
  const act = useMutation({
    mutationFn: (input: { id: string; action: 'rehearse' | 'approve' | 'reject' }) => {
      if (input.action === 'rehearse') return api.rehearse(input.id);
      if (input.action === 'approve') return api.approve(input.id);
      return api.reject(input.id);
    },
    onSuccess: (_result, input) => {
      toast.success(
        input.action === 'rehearse'
          ? 'Rehearsal recorded'
          : input.action === 'approve'
            ? 'Review approved'
            : 'Review rejected',
      );
    },
  });
  const rows = reviews.data?.data ?? [];
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        Draft SQL stays off the live branch until rehearsal succeeds and an administrator approves
        it. Rehearsal uses an isolated scratch catalog. A destructive badge is a classifier hint,
        not proof the statement is safe. Approval binds the current schema version and SQL digest.
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">Up to 100 reviews on this branch</p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={reviews.isFetching}
            onClick={() => void reviews.refetch()}
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
            New review
          </Button>
        </div>
      </div>
      {reviews.error && (
        <p role="alert" className="text-sm text-destructive">
          {reviews.error.message}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {reviews.isPending ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : !rows.length ? (
          <div className="p-8">
            <Empty title="No schema reviews">
              Create a draft with a migration id and SQL. Nothing is applied from this screen.
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Migration</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Destructive</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>
                    <button
                      className="text-left font-medium underline-offset-4 hover:underline"
                      onClick={() => setSelected(review.id)}
                    >
                      {review.migrationId}
                    </button>
                    <span className="block font-mono text-xs text-muted-foreground">
                      schema v{review.baseSchemaVersion}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StateBadge state={review.state} />
                  </TableCell>
                  <TableCell>
                    <DestructiveBadges review={review} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(review.updatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {rehearseStates.includes(review.state) && (
                        <Button
                          variant="secondary"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: review.id, action: 'rehearse' })}
                        >
                          Rehearse
                        </Button>
                      )}
                      {review.state === 'rehearsed' && (
                        <Button
                          variant="secondary"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: review.id, action: 'approve' })}
                        >
                          Approve
                        </Button>
                      )}
                      {review.state !== 'applied' && review.state !== 'rejected' && (
                        <Button
                          variant="secondary"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: review.id, action: 'reject' })}
                        >
                          Reject
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
      {act.error && (
        <p role="alert" className="text-sm text-destructive">
          {act.error.message}
        </p>
      )}
      <Dialog open={creating} onOpenChange={(open) => !create.isPending && setCreating(open)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>New schema review</DialogTitle>
          <DialogDescription>
            The draft is stored for this branch. Rehearse before approval. This does not migrate
            the live database.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="review-migration">Migration id</FieldLabel>
              <Input
                id="review-migration"
                required
                maxLength={100}
                pattern="[A-Za-z0-9_-]{1,100}"
                value={migrationId}
                onChange={(event) => setMigrationId(event.target.value)}
                placeholder="add-tasks-title"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="review-sql">SQL</FieldLabel>
              <Textarea
                id="review-sql"
                required
                className="min-h-40 font-mono text-xs"
                value={sql}
                onChange={(event) => setSql(event.target.value)}
                spellCheck={false}
              />
            </Field>
            {create.error && (
              <p role="alert" className="text-sm text-destructive">
                {create.error.message}
              </p>
            )}
            <Button type="submit" disabled={create.isPending || !migrationId.trim() || !sql.trim()}>
              {create.isPending ? 'Saving…' : 'Create draft'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>{detail.data?.data.migrationId ?? 'Schema review'}</DialogTitle>
          <DialogDescription>
            {detail.data?.data.rehearsalNotes ?? 'SQL and rehearsal notes for this draft.'}
          </DialogDescription>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <p role="alert" className="text-sm text-destructive">
              {detail.error.message}
            </p>
          ) : detail.data ? (
            <ReviewDetail review={detail.data.data} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StateBadge({ state }: { state: ReviewState }) {
  const variant = state === 'stale' || state === 'rejected' ? 'warning' : 'outline';
  return <Badge variant={variant}>{state}</Badge>;
}

function DestructiveBadges({ review }: { review: SchemaReviewSummary }) {
  if (!review.destructive.length) return <span className="text-xs text-muted-foreground">None flagged</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {review.destructive.map((finding) => (
        <Badge key={finding.kind} variant="warning" title={finding.detail}>
          {finding.kind.replaceAll('_', ' ')}
        </Badge>
      ))}
    </div>
  );
}

function ReviewDetail({ review }: { review: SchemaReviewDetail }) {
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={review.state} />
        <DestructiveBadges review={review} />
        {review.typeCheckOk === true && <Badge variant="success">Types compiled</Badge>}
        {review.typeCheckOk === false && <Badge variant="warning">Type check failed</Badge>}
      </div>
      <p className="m-0 font-mono text-xs text-muted-foreground">digest {review.digest}</p>
      <pre className="m-0 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
        {review.sql}
      </pre>
    </div>
  );
}
