import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, Plus } from 'lucide-react';
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
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@qb-flex/ui';
import { management } from '../api';
import { useWrite } from './shared';
import { SettingsBanner, SettingsPanel } from './settings-layout';

export function BackupWorkspace({ base, project }: { base: string; project: any }) {
  const backups = useQuery({
    queryKey: ['backups', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/backups`),
  });
  const branches = useQuery({
    queryKey: ['branches', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/branches`),
  });
  const write = useWrite();
  const [restore, setRestore] = useState('');
  const [cutover, setCutover] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <div className="flex flex-col gap-8">
      <SettingsBanner>
        Restore creates a separate branch and excludes active sessions. Object bytes require a
        separate S3-compatible backup.
      </SettingsBanner>
      <SettingsPanel
        action={
          <Button
            disabled={write.isPending}
            onClick={async () => {
              await write.mutateAsync({ path: base + '/backups', body: {} });
              toast.success('Snapshot created');
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            <Plus data-icon="inline-start" /> Create backup
          </Button>
        }
        description="Encrypted database snapshots for this project."
        title="Encrypted database snapshots"
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {write.error ? (
            <div className="p-4">
            </div>
          ) : null}
          {backups.isPending ? (
            <div className="p-4">
              <Loading />
            </div>
          ) : !backups.data?.data.length ? (
            <div className="p-6">
              <Empty title="No snapshots yet" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Snapshot</TableHead>
                  <TableHead>Schema</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.data.data.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono">{b.id.slice(0, 12)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">v{b.schema_version}</Badge>
                    </TableCell>
                    <TableCell>{new Date(b.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" onClick={() => setRestore(b.id)}>
                        Restore separately
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SettingsPanel>
      <SettingsPanel
        description="Validate a restored branch before switching production traffic. Cutover creates a rollback checkpoint, fences the old owner and signs application users out."
        title="Validated restore cutover"
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {(branches.data?.data ?? [])
            .filter((branch: any) => branch.status === 'ready' && branch.name !== 'main')
            .map((branch: any) => (
              <div
                className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                key={branch.id}
              >
                <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <code className="font-mono text-xs">{branch.name}</code>
                <Button
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    setCutover(branch.id);
                    setConfirmation('');
                  }}
                >
                  Make primary
                </Button>
              </div>
            ))}
          {!branches.data?.data.filter((b: any) => b.status === 'ready' && b.name !== 'main')
            .length && (
            <div className="p-6">
              <Empty title="No restored branches to promote" />
            </div>
          )}
        </div>
      </SettingsPanel>
      <Dialog open={!!cutover} onOpenChange={(open) => !open && setCutover('')}>
        <DialogContent>
          <DialogTitle>Switch primary branch</DialogTitle>
          <DialogDescription>
            This redirects production database traffic to the selected restored branch.
          </DialogDescription>
          <Field>
            <FieldLabel htmlFor="cutover-confirm">
              Type the project slug: <span className="font-mono">{project.slug}</span>
            </FieldLabel>
            <Input
              id="cutover-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Button
            variant="danger"
            disabled={confirmation !== project.slug || write.isPending}
            onClick={async () => {
              const switchResult = await write.mutateAsync({
                path: `/projects/${project.id}/branches/${cutover}/cutover`,
                body: { confirm: confirmation },
              });
              toast.success('Primary branch switched', {
                description: 'Primary switched to ' + switchResult.data.branchId,
              });
              setCutover('');
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Switch production traffic
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!restore} onOpenChange={(v) => !v && setRestore('')}>
        <DialogContent>
          <DialogTitle>Restore an isolated branch</DialogTitle>
          <DialogDescription>
            The primary branch is not switched by this operation.
          </DialogDescription>
          <p>
            Snapshot: <code className="font-mono text-xs">{restore}</code>
          </p>
          <Button
            disabled={write.isPending}
            onClick={async () => {
              const restoreResult = await write.mutateAsync({
                path: `/projects/${project.id}/backups/${restore}/restore`,
                body: {},
              });
              toast.success('Snapshot restored to a new branch', {
                description:
                  'Restored branch ' + restoreResult.data.branchId + ' is ready for validation.',
              });
              setRestore('');
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Restore snapshot
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
