import { useEffect, useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
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
import { SettingsBanner, SettingsPanel, SettingsSection, SettingsSectionGroup } from './settings-layout';

const INTERVALS = [
  { value: '1', label: 'Every hour' },
  { value: '6', label: 'Every 6 hours' },
  { value: '12', label: 'Every 12 hours' },
  { value: '24', label: 'Every day' },
  { value: '168', label: 'Every week' },
] as const;

export function BackupWorkspace({ base, project }: { base: string; project: any }) {
  const backups = useQuery({
    queryKey: ['backups', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/backups`),
  });
  const branches = useQuery({
    queryKey: ['branches', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/branches`),
  });
  const recovery = useQuery({
    queryKey: ['recovery', project.id],
    queryFn: () => management.request<any>(`/projects/${project.id}/recovery`),
  });
  const inventory = useQuery({
    queryKey: ['recovery-inventory', project.id],
    queryFn: () => management.request<any>(`/projects/${project.id}/recovery/inventory`),
  });
  const destinations = useQuery({
    queryKey: ['recovery-destinations', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/recovery/destinations`),
  });
  const drills = useQuery({
    queryKey: ['recovery-drills', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/recovery/drills`),
  });
  const write = useWrite();
  const [restore, setRestore] = useState('');
  const [cutover, setCutover] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [intervalHours, setIntervalHours] = useState('24');
  const [retentionDays, setRetentionDays] = useState('7');
  const [retentionWeeks, setRetentionWeeks] = useState('4');
  const [drillIntervalHours, setDrillIntervalHours] = useState('0');
  const [destinationForm, setDestinationForm] = useState({
    name: '',
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    prefix: '',
    accessKeyId: '',
    secretAccessKey: '',
  });
  useEffect(() => {
    const settings = recovery.data?.data;
    if (!settings) return;
    setEnabled(Boolean(settings.enabled));
    setIntervalHours(String(settings.intervalHours ?? 24));
    setRetentionDays(String(settings.retentionDays ?? 7));
    setRetentionWeeks(String(settings.retentionWeeks ?? 4));
    setDrillIntervalHours(String(settings.drillIntervalHours ?? 0));
  }, [recovery.data]);
  return (
    <div className="flex flex-col gap-8">
      <SettingsBanner>
        Encrypted local snapshots remain available. Off-node destinations, freshness warnings and
        isolated restore drills are experimental. Object bytes and master-key custody stay separate.
      </SettingsBanner>
      <SettingsPanel
        description="Schedule primary-branch snapshots and retention for this project. Deployment environment ceilings still apply."
        title="Automatic backups"
      >
        {recovery.isPending ? (
          <Loading />
        ) : (
          <SettingsSectionGroup>
            <SettingsSection title="Schedule">
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label="Enable automatic backups"
                />
                Enable automatic backups
              </label>
              <Field className="mt-4 max-w-md">
                <FieldLabel htmlFor="backup-interval">Snapshot interval</FieldLabel>
                <Select value={intervalHours} onValueChange={setIntervalHours}>
                  <SelectTrigger id="backup-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVALS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </SettingsSection>
            <SettingsSection title="Retention">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="retention-days">Daily days</FieldLabel>
                  <Input
                    id="retention-days"
                    type="number"
                    min="1"
                    max="365"
                    value={retentionDays}
                    onChange={(event) => setRetentionDays(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="retention-weeks">Weekly copies</FieldLabel>
                  <Input
                    id="retention-weeks"
                    type="number"
                    min="0"
                    max="52"
                    value={retentionWeeks}
                    onChange={(event) => setRetentionWeeks(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="drill-interval">Drill interval (hours)</FieldLabel>
                  <Input
                    id="drill-interval"
                    type="number"
                    min="0"
                    max="8760"
                    value={drillIntervalHours}
                    onChange={(event) => setDrillIntervalHours(event.target.value)}
                    aria-describedby="drill-interval-hint"
                  />
                  <p id="drill-interval-hint" className="mt-1 text-xs text-muted-foreground">
                    Use 0 for manual drills only.
                  </p>
                </Field>
              </div>
            </SettingsSection>
            <SettingsSection title="Save">
              <Button
                className="w-fit"
                disabled={write.isPending || !recovery.data}
                onClick={async () => {
                  await write.mutateAsync({
                    path: `/projects/${project.id}/recovery`,
                    method: 'PUT',
                    headers: { 'if-match': String(recovery.data!.data.version) },
                    body: {
                      enabled,
                      intervalHours: Number(intervalHours),
                      retentionDays: Number(retentionDays),
                      retentionWeeks: Number(retentionWeeks),
                      drillIntervalHours: Number(drillIntervalHours),
                    },
                  });
                  toast.success('Automatic backup settings saved');
                }}
              >
                {write.isPending && <Spinner data-icon="inline-start" />}
                Save schedule
              </Button>
            </SettingsSection>
          </SettingsSectionGroup>
        )}
      </SettingsPanel>
      <SettingsPanel
        description="Encrypted archives upload to a separate S3-compatible destination. Credentials are write-only and never returned."
        title="Recovery destinations"
      >
        <SettingsSectionGroup>
          <SettingsSection title="Configured destinations">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {destinations.isPending ? (
                <div className="p-4">
                  <Loading />
                </div>
              ) : !destinations.data?.data.length ? (
                <div className="p-6">
                  <Empty title="No off-node destinations" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Bucket</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {destinations.data.data.map((destination: any) => (
                      <TableRow key={destination.id}>
                        <TableCell>{destination.name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {destination.bucket}
                          {destination.prefix ? `/${destination.prefix}` : ''}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{destination.state}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            disabled={write.isPending}
                            onClick={async () => {
                              await write.mutateAsync({
                                path: `/projects/${project.id}/recovery/destinations/${destination.id}/state`,
                                body: {
                                  state: destination.state === 'active' ? 'disabled' : 'active',
                                },
                              });
                              toast.success(
                                destination.state === 'active'
                                  ? 'Destination disabled'
                                  : 'Destination enabled',
                              );
                            }}
                          >
                            {destination.state === 'active' ? 'Disable' : 'Enable'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </SettingsSection>
          <SettingsSection title="Add destination">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="dest-name">Name</FieldLabel>
                <Input
                  id="dest-name"
                  value={destinationForm.name}
                  onChange={(event) =>
                    setDestinationForm({ ...destinationForm, name: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dest-endpoint">HTTPS endpoint</FieldLabel>
                <Input
                  id="dest-endpoint"
                  value={destinationForm.endpoint}
                  onChange={(event) =>
                    setDestinationForm({ ...destinationForm, endpoint: event.target.value })
                  }
                  placeholder="https://s3.example.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dest-region">Region</FieldLabel>
                <Input
                  id="dest-region"
                  value={destinationForm.region}
                  onChange={(event) =>
                    setDestinationForm({ ...destinationForm, region: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dest-bucket">Bucket</FieldLabel>
                <Input
                  id="dest-bucket"
                  value={destinationForm.bucket}
                  onChange={(event) =>
                    setDestinationForm({ ...destinationForm, bucket: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dest-prefix">Prefix</FieldLabel>
                <Input
                  id="dest-prefix"
                  value={destinationForm.prefix}
                  onChange={(event) =>
                    setDestinationForm({ ...destinationForm, prefix: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dest-access">Access key ID</FieldLabel>
                <Input
                  id="dest-access"
                  value={destinationForm.accessKeyId}
                  onChange={(event) =>
                    setDestinationForm({ ...destinationForm, accessKeyId: event.target.value })
                  }
                  autoComplete="off"
                />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="dest-secret">Secret access key</FieldLabel>
                <Input
                  id="dest-secret"
                  type="password"
                  value={destinationForm.secretAccessKey}
                  onChange={(event) =>
                    setDestinationForm({
                      ...destinationForm,
                      secretAccessKey: event.target.value,
                    })
                  }
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <Button
              className="mt-4 w-fit"
              disabled={write.isPending}
              onClick={async () => {
                await write.mutateAsync({
                  path: `/projects/${project.id}/recovery/destinations`,
                  body: destinationForm,
                });
                setDestinationForm({
                  name: '',
                  endpoint: '',
                  region: 'us-east-1',
                  bucket: '',
                  prefix: '',
                  accessKeyId: '',
                  secretAccessKey: '',
                });
                toast.success('Recovery destination added');
              }}
            >
              {write.isPending && <Spinner data-icon="inline-start" />}
              Add destination
            </Button>
          </SettingsSection>
        </SettingsSectionGroup>
      </SettingsPanel>
      <SettingsPanel
        description="Local archives and off-node replica state. Stale means older than the configured interval."
        title="Inventory and freshness"
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {inventory.isPending ? (
            <div className="p-4">
              <Loading />
            </div>
          ) : !inventory.data?.data.items?.length ? (
            <div className="p-6">
              <Empty title="No snapshots in inventory" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Snapshot</TableHead>
                  <TableHead>Schema</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Replicas</TableHead>
                  <TableHead>Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.data.data.items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono">{item.id.slice(0, 12)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">v{item.schemaVersion}</Badge>
                    </TableCell>
                    <TableCell>{Math.round(item.ageMs / 3600000)}h</TableCell>
                    <TableCell>
                      {(item.replicas ?? [])
                        .map((replica: any) => replica.state)
                        .join(', ') || 'local only'}
                    </TableCell>
                    <TableCell>
                      {item.stale ? (
                        <Badge variant="destructive">stale</Badge>
                      ) : (
                        <Badge variant="outline">fresh</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {(inventory.data?.data.findings ?? []).length > 0 ? (
          <div className="mt-4 space-y-2">
            {inventory.data.data.findings.map((finding: any) => (
              <p key={finding.id} className="text-sm text-muted-foreground">
                <span className="font-mono text-xs">{finding.code}</span> {finding.message}
              </p>
            ))}
          </div>
        ) : null}
      </SettingsPanel>
      <SettingsPanel
        description="Isolated restore drills validate the database, object-backup availability and master-key authentication without changing the primary branch."
        title="Restore drills"
        action={
          <Button
            disabled={write.isPending || !backups.data?.data?.length}
            onClick={async () => {
              const newest = backups.data!.data[0];
              await write.mutateAsync({
                path: `/projects/${project.id}/recovery/drills`,
                body: { backupId: newest.id },
              });
              toast.success('Recovery drill queued');
            }}
          >
            {write.isPending && <Spinner data-icon="inline-start" />}
            Start drill
          </Button>
        }
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {drills.isPending ? (
            <div className="p-4">
              <Loading />
            </div>
          ) : !drills.data?.data?.length ? (
            <div className="p-6">
              <Empty title="No drills yet" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drill</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Objects</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drills.data.data.map((drill: any) => (
                  <TableRow key={drill.id}>
                    <TableCell className="font-mono">{drill.id.slice(0, 12)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{drill.state}</Badge>
                    </TableCell>
                    <TableCell>{drill.databaseResult ?? '—'}</TableCell>
                    <TableCell>{drill.objectsResult ?? '—'}</TableCell>
                    <TableCell>{drill.keyResult ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {['queued', 'restoring', 'validating'].includes(drill.state) ? (
                        <Button
                          variant="ghost"
                          disabled={write.isPending}
                          onClick={async () => {
                            await write.mutateAsync({
                              path: `/projects/${project.id}/recovery/drills/${drill.id}/cancel`,
                            });
                            toast.success('Drill cancelled');
                          }}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SettingsPanel>
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
          {write.error ? <div className="p-4"></div> : null}
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
