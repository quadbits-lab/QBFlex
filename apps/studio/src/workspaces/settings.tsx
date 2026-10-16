import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Empty,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Loading,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShadcnButton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  toast,
  notifyError,
} from '@qb-flex/ui';
import { management, docsURL, raw } from '../api';
import { useConsole } from '../console-context';
import { refreshStudioQueries } from '../query-client';
import { usePlatformPasskeys, type PlatformPasskey } from '../platform-passkeys';
import { AccountProfilePanel } from './account-profile';
import {
  DangerCard,
  SettingsBanner,
  SettingsFormSection,
  SettingsMain,
  SettingsSection,
  SettingsSectionGroup,
  SettingsShellLayout,
  settingsNavListClassName,
  settingsNavTriggerClassName,
} from './settings-layout';
import { ErrorMessage, useWrite } from './shared';

export function SettingsWorkspace({
  project,
  organizationId,
}: {
  project: any;
  organizationId: string;
}) {
  const members = useQuery({
    queryKey: ['members', organizationId],
    enabled: !!organizationId,
    queryFn: () => management.request<any[]>(`/organizations/${organizationId}/members`),
  });
  const write = useWrite();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [managementToken, setManagementToken] = useState('');
  const [organizationScope, setOrganizationScope] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [organizationName, setOrganizationName] = useState('');
  const tokens = useQuery({
    queryKey: ['management-tokens'],
    queryFn: () => management.request<any[]>('/tokens'),
  });
  useEffect(() => setManagementToken(''), [project?.id, organizationId]);
  return (
    <Tabs defaultValue="general" orientation="vertical" className="min-w-0 gap-0">
      <SettingsShellLayout
        nav={
          <TabsList aria-label="Settings sections" className={settingsNavListClassName}>
            <TabsTrigger className={settingsNavTriggerClassName} value="general">
              General
            </TabsTrigger>
            <TabsTrigger className={settingsNavTriggerClassName} value="project">
              Project
            </TabsTrigger>
            <TabsTrigger className={settingsNavTriggerClassName} value="members">
              Members
            </TabsTrigger>
            <TabsTrigger className={settingsNavTriggerClassName} value="security">
              Security
            </TabsTrigger>
            <TabsTrigger className={settingsNavTriggerClassName} value="integrations">
              Integrations
            </TabsTrigger>
          </TabsList>
        }
      >
        <SettingsMain>
          <TabsContent value="general" className="mt-0 outline-none">
            <AccountProfilePanel organizationId={organizationId} />
          </TabsContent>

          <TabsContent value="project" className="mt-0 outline-none">
            {project ? (
              <div className="space-y-4">
                <ProjectIdentity project={project} />
                <ProjectQuotas project={project} />
                <ProjectDelete project={project} />
              </div>
            ) : (
              <Empty title="Select a project">
                Create a project to configure identity, quotas, and deletion.
              </Empty>
            )}
          </TabsContent>

          <TabsContent value="members" className="mt-0 outline-none">
            <div className="space-y-4">
              <SettingsFormSection
                description="Manage members and projects across teams."
                title="Create an organization"
              >
                <Field>
                  <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      id="org-name"
                      className="max-w-md"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="Acme Platform"
                    />
                    <Button
                      disabled={!organizationName || write.isPending}
                      onClick={async () => {
                        await write.mutateAsync({
                          path: '/organizations',
                          body: { name: organizationName },
                        });
                        toast.success('Organization created');
                        setOrganizationName('');
                      }}
                    >
                      {write.isPending && <Spinner data-icon="inline-start" />}
                      Create organization
                    </Button>
                  </div>
                </Field>
              </SettingsFormSection>

              <SettingsFormSection
                description={`${members.data?.data.length ?? 0} platform accounts with access.`}
                title="Organization members"
              >
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {(members.data?.data ?? []).map((m: any) => (
                    <div
                      className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                      key={m.user_id}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted">
                        <UserRound className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <strong className="block text-sm">{m.name}</strong>
                        <small className="block text-muted-foreground">{m.email}</small>
                      </div>
                      {m.role === 'owner' ? (
                        <Badge variant="success">owner</Badge>
                      ) : (
                        <Select
                          value={m.role}
                          onValueChange={async (value) => {
                            await write.mutateAsync({
                              path: `/organizations/${organizationId}/members`,
                              body: { email: m.email, role: value },
                            });
                            toast.success(m.email + ' is now ' + value);
                          }}
                        >
                          <SelectTrigger className="w-32" aria-label={'Role for ' + m.email}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {['viewer', 'developer', 'admin'].map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ))}
                  {!members.data?.data.length && !members.isPending ? (
                    <div className="px-4 py-6">
                      <Empty title="No members yet" />
                    </div>
                  ) : null}
                </div>
              </SettingsFormSection>

              <SettingsFormSection
                description="Invite a platform account with a temporary password."
                title="Add a platform account"
                footer={
                  <Button
                    disabled={write.isPending || password.length < 12 || !email || !name}
                    onClick={async () => {
                      await write.mutateAsync({
                        path: '/invitations',
                        body: {
                          organizationId,
                          name,
                          email,
                          temporaryPassword: password,
                          role,
                        },
                      });
                      toast.success(name + ' added as ' + role);
                      setPassword('');
                      setEmail('');
                      setName('');
                    }}
                  >
                    {write.isPending && <Spinner data-icon="inline-start" />}
                    Add member
                  </Button>
                }
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="member-name">Name</FieldLabel>
                    <Input
                      id="member-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="member-email">Email</FieldLabel>
                    <Input
                      id="member-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="member-password">Temporary password</FieldLabel>
                    <Input
                      id="member-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={12}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="member-role">Organization role</FieldLabel>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger id="member-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {['viewer', 'developer', 'admin'].map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </SettingsFormSection>
            </div>
          </TabsContent>

          <TabsContent value="integrations" className="mt-0 outline-none">
            <div className="space-y-4">
              <SettingsFormSection
                description="30-day management tokens; scope the organization only when automation creates projects."
                title="CLI and automation credentials"
              >
                <SettingsSectionGroup>
                  <SettingsSection
                    description="Restrict the token to read operations."
                    title="Read-only access"
                  >
                    <label className="flex cursor-pointer items-center gap-3 text-sm">
                      <Checkbox
                        checked={readOnly}
                        onCheckedChange={(v) => setReadOnly(v === true)}
                      />
                      Enable read-only mode
                    </label>
                  </SettingsSection>
                  <SettingsSection
                    description="Allow creating and managing projects in this organization."
                    title="Organization scope"
                  >
                    <label className="flex cursor-pointer items-center gap-3 text-sm">
                      <Checkbox
                        checked={organizationScope}
                        onCheckedChange={(v) => setOrganizationScope(v === true)}
                      />
                      Include this organization's project lifecycle
                    </label>
                  </SettingsSection>
                  <SettingsSection
                    description="The token value is shown once. Store it as QB_MANAGEMENT_TOKEN."
                    title="Create token"
                  >
                    <div className="flex flex-col gap-3">
                      {managementToken && (
                        <Alert>
                          <ShieldCheck aria-hidden="true" />
                          <AlertTitle>Copy this token once</AlertTitle>
                          <AlertDescription>
                            Set <code className="font-mono">QB_MANAGEMENT_TOKEN</code> in your
                            environment store.
                          </AlertDescription>
                          <div className="mt-2 flex items-center gap-2">
                            <code className="min-w-0 flex-1 break-all whitespace-normal">
                              {managementToken}
                            </code>
                            <ShadcnButton
                              variant="ghost"
                              size="icon"
                              aria-label="Copy token"
                              onClick={async () => {
                                await navigator.clipboard.writeText(managementToken);
                                toast.success('Token copied');
                              }}
                            >
                              Copy
                            </ShadcnButton>
                            <ShadcnButton
                              variant="ghost"
                              size="icon"
                              aria-label="Hide token"
                              onClick={() => setManagementToken('')}
                            >
                              Hide
                            </ShadcnButton>
                          </div>
                        </Alert>
                      )}
                      <Button
                        className="w-fit"
                        disabled={write.isPending || (!project && !organizationScope)}
                        onClick={async () => {
                          const tokenResult = await write.mutateAsync({
                            path: '/tokens',
                            body: {
                              projects: project ? [project.id] : [],
                              organizations: organizationScope ? [organizationId] : [],
                              readOnly,
                            },
                          });
                          setManagementToken(tokenResult.data.token);
                          toast.success('Management token created');
                        }}
                      >
                        {write.isPending && <Spinner data-icon="inline-start" />}
                        Create management token
                      </Button>
                    </div>
                  </SettingsSection>
                </SettingsSectionGroup>
              </SettingsFormSection>

              <SettingsFormSection
                description="Active tokens for CLI and automation."
                title="Active tokens"
              >
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {(tokens.data?.data ?? [])
                    .filter((token: any) => !token.revoked_at)
                    .map((token: any) => (
                      <div
                        className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                        key={token.id}
                      >
                        <code className="font-mono text-xs">{token.id.slice(0, 12)}</code>
                        <small className="text-muted-foreground">
                          Expires {new Date(token.expires_at).toLocaleDateString()}
                        </small>
                        <Button
                          variant="ghost"
                          className="ml-auto"
                          onClick={async () => {
                            await write.mutateAsync({
                              path: '/tokens/' + token.id,
                              method: 'DELETE',
                            });
                            toast.success('Token revoked');
                          }}
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                  {!(tokens.data?.data ?? []).filter((token: any) => !token.revoked_at).length ? (
                    <div className="px-4 py-6">
                      <Empty title="No active tokens" />
                    </div>
                  ) : null}
                </div>
              </SettingsFormSection>

              <SettingsFormSection
                description="Revoking credentials immediately blocks CLI and automation clients using them."
                title="Credential hygiene"
              >
                <DangerCard
                  title="Rotate tokens regularly"
                  description="Prefer short-lived, least-privilege tokens and revoke them after use."
                />
              </SettingsFormSection>
            </div>
          </TabsContent>

          <TabsContent value="security" className="mt-0 outline-none">
            <div className="space-y-4">
              <SettingsFormSection
                title="Security posture"
                description="Production deployments enforce administrator MFA. Passkeys complement TOTP for platform sign-in."
              >
                <SettingsBanner>
                  Keep at least one recovery path (authenticator backup codes or a second passkey)
                  before enabling MFA on production owners.
                </SettingsBanner>
              </SettingsFormSection>
              <AdminMfaCard />
              <PasskeysCard />
            </div>
          </TabsContent>
        </SettingsMain>
      </SettingsShellLayout>
    </Tabs>
  );
}

function AdminMfaCard() {
  const cache = useQueryClient();
  const [recovery, setRecovery] = useState<string[]>([]);
  const [mfa, setMfa] = useState('');
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  return (
    <SettingsFormSection
      description="TOTP with backup codes; production deployments enforce enrollment."
      title="Administrator two-factor authentication"
    >
      <Field>
        <FieldLabel htmlFor="mfa-password">Current password</FieldLabel>
        <Input
          id="mfa-password"
          className="max-w-md"
          type="password"
          value={mfaPassword}
          onChange={(e) => setMfaPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <div className="flex flex-col gap-3">
        <Button
          className="w-fit"
          variant="ghost"
          onClick={async () => {
            try {
              const enableResult = await raw('/platform/auth/two-factor/enable', 'POST', {
                password: mfaPassword,
              });
              setMfa(enableResult.totpURI);
              setRecovery(enableResult.backupCodes ?? []);
              setMfaPassword('');
              await refreshStudioQueries(cache);
              toast.success('Authenticator setup started');
            } catch (enableError) {
              notifyError(enableError, 'Unable to enable authenticator');
            }
          }}
        >
          Enable authenticator
        </Button>
        {mfa && (
          <>
            <p className="m-0 text-sm text-muted-foreground">
              Import this URI into your authenticator, then verify a code.
            </p>
            <code className="mono overflow-x-auto break-all whitespace-normal rounded-md bg-muted px-3 py-2 text-xs">
              {mfa}
            </code>
            <Field>
              <FieldLabel htmlFor="mfa-code">Authenticator code</FieldLabel>
              <Input
                id="mfa-code"
                className="max-w-xs"
                inputMode="numeric"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </Field>
            <Button
              className="w-fit"
              onClick={async () => {
                try {
                  await raw('/platform/auth/two-factor/verify-totp', 'POST', { code: mfaCode });
                  setMfa('');
                  setMfaCode('');
                  await refreshStudioQueries(cache);
                  toast.success('Authenticator enrollment verified');
                } catch (verifyError) {
                  notifyError(verifyError, 'Unable to verify authenticator');
                }
              }}
            >
              Verify enrollment
            </Button>
          </>
        )}
        {recovery.length > 0 && (
          <Alert>
            <AlertTitle>Save these recovery codes once</AlertTitle>
            <AlertDescription>Store them in a secure password manager.</AlertDescription>
            <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
              {recovery.join('\n')}
            </pre>
          </Alert>
        )}
      </div>
    </SettingsFormSection>
  );
}

function PasskeysCard() {
  const { passkeys, pending, error, enroll, remove, rename } = usePlatformPasskeys();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<PlatformPasskey | null>(null);
  const [nextName, setNextName] = useState('');
  const [deleting, setDeleting] = useState<PlatformPasskey | null>(null);
  return (
    <SettingsFormSection
      description="WebAuthn sign-in for platform accounts; complements the admin TOTP requirement."
      title="Passkeys"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {passkeys.map((p: PlatformPasskey) => (
          <div
            className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
            key={p.id}
          >
            <Fingerprint className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{p.name ?? 'Passkey'}</strong>
              <small className="block truncate font-mono text-2xs text-muted-foreground">
                {p.id.slice(0, 18)}…
              </small>
            </div>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setEditing(p);
                setNextName(p.name ?? 'Passkey');
              }}
            >
              Rename
            </Button>
            <ShadcnButton
              variant="ghost"
              size="icon"
              className="text-destructive-foreground hover:text-destructive"
              aria-label={'Delete passkey ' + (p.name ?? p.id)}
              disabled={pending}
              onClick={() => setDeleting(p)}
            >
              <Trash2 />
            </ShadcnButton>
          </div>
        ))}
        {!passkeys.length && !pending && !error && (
          <div className="px-4 py-6">
            <Empty title="No passkeys enrolled yet">
              Add one from this browser to enable WebAuthn sign-in.
            </Empty>
          </div>
        )}
        {pending && (
          <div className="px-4 py-6">
            <Loading />
          </div>
        )}
      </div>
      <Field>
        <FieldLabel htmlFor="passkey-name">Add passkey</FieldLabel>
        <InputGroup className="max-w-lg">
          <InputGroupInput
            id="passkey-name"
            placeholder="MacBook Touch ID"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <Button
              disabled={pending}
              onClick={async () => {
                if (await enroll(name || 'Passkey')) setName('');
              }}
            >
              <Plus data-icon="inline-start" /> Add passkey
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </Field>
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogTitle>Rename passkey</DialogTitle>
          <DialogDescription>Give this device a recognizable name.</DialogDescription>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rename-passkey">Name</FieldLabel>
              <Input
                id="rename-passkey"
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
              />
            </Field>
            <Button
              disabled={pending || !nextName.trim()}
              onClick={async () => {
                if (editing && (await rename(editing.id, nextName.trim()))) setEditing(null);
              }}
            >
              Save name
            </Button>
          </FieldGroup>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete passkey?</AlertDialogTitle>
          <AlertDialogDescription>
            {deleting?.name ?? 'This device'} will no longer be able to sign in with this passkey.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={async (e) => {
                e.preventDefault();
                if (deleting && (await remove(deleting.id))) setDeleting(null);
              }}
            >
              Delete passkey
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsFormSection>
  );
}

const BYTES_PER_MB = 1024 * 1024;
const MAX_QUOTA_VALUE = 1099511627776;
const BYTE_QUOTA_FIELDS = [
  ['databaseBytes', 'Database size per branch'],
  ['storageBytes', 'Reserved object storage per branch'],
] as const;

const MAX_PROJECT_NAME_LENGTH = 100;
const LOCAL_PROJECT_REGION = 'local';

function ProjectIdentity({
  project,
}: {
  project: { id: string; name: string; slug: string; region: string; status: string };
}) {
  const write = useWrite();
  const [name, setName] = useState(project.name);
  const [region, setRegion] = useState(project.region);
  useEffect(() => {
    setName(project.name);
    setRegion(project.region);
  }, [project.id, project.name, project.region]);
  const trimmedName = name.trim();
  const unchanged = trimmedName === project.name && region === project.region;
  return (
    <SettingsFormSection
      title="Project identity"
      description="Name, region, and status for the selected project. Slug stays fixed after creation."
      footer={
        <Button
          disabled={write.isPending || unchanged || !trimmedName}
          onClick={async () => {
            if (trimmedName.length > MAX_PROJECT_NAME_LENGTH) {
              toast.error('Project name is at most 100 characters');
              return;
            }
            if (region !== LOCAL_PROJECT_REGION) {
              toast.error('This release places projects in the local region');
              return;
            }
            await write.mutateAsync({
              path: `/projects/${project.id}`,
              method: 'PATCH',
              body: { name: trimmedName, region },
            });
            toast.success('Project saved');
          }}
        >
          {write.isPending && <Spinner data-icon="inline-start" />}
          Save Changes
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="project-name">Name</FieldLabel>
          <Input
            id="project-name"
            value={name}
            maxLength={MAX_PROJECT_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
          <Input id="project-slug" readOnly value={project.slug} className="font-mono text-xs" />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-region">Region</FieldLabel>
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger id="project-region" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={LOCAL_PROJECT_REGION}>Local / single node</SelectItem>
                {project.region !== LOCAL_PROJECT_REGION ? (
                  <SelectItem value={project.region}>{project.region}</SelectItem>
                ) : null}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            This release accepts local and keeps the project on this node.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <div className="pt-1.5">
            <Badge variant={project.status === 'ready' ? 'success' : 'warning'}>
              {project.status}
            </Badge>
          </div>
        </Field>
      </div>
      <SettingsBanner
        actions={
          <ShadcnButton
            size="sm"
            variant="outline"
            onClick={() => (location.href = docsURL + '/docs/self-hosting/deployment')}
          >
            Self-hosting guide
          </ShadcnButton>
        }
      >
        Quotas apply per branch. Changing limits closes affected owners so clients may reconnect.
      </SettingsBanner>
    </SettingsFormSection>
  );
}

function ProjectDelete({
  project,
}: {
  project: { id: string; name: string; slug: string };
}) {
  const cache = useQueryClient();
  const { select } = useConsole();
  const [open, setOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [deleting, setDeleting] = useState(false);
  const ready = confirmSlug.trim() === project.slug;

  return (
    <>
      <DangerCard
        title="Delete project"
        description="Permanently removes this project only: branch databases, function trees, storage objects under its prefixes, keys, secrets, backups, and project audit rows. Other projects in the workspace are not modified."
        action={
          <ShadcnButton
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              setConfirmSlug('');
              setOpen(true);
            }}
          >
            <Trash2 data-icon="inline-start" />
            {deleting ? 'Deleting…' : 'Delete project'}
          </ShadcnButton>
        }
      />
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmSlug('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete project permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            Type the project slug <strong className="font-mono">{project.slug}</strong> to confirm.
            This deletes only <strong>{project.name}</strong> and its artifacts. Other projects and
            the workspace remain. This cannot be undone.
          </AlertDialogDescription>
          <Field>
            <FieldLabel htmlFor="confirm-project-delete">Project slug</FieldLabel>
            <Input
              id="confirm-project-delete"
              value={confirmSlug}
              autoComplete="off"
              className="font-mono text-xs"
              placeholder={project.slug}
              onChange={(event) => setConfirmSlug(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || !ready}
              onClick={async (event) => {
                event.preventDefault();
                if (!ready) return;
                setDeleting(true);
                try {
                  await management.request(`/projects/${project.id}`, 'DELETE');
                  select({ project: '', branch: 'primary' });
                  await refreshStudioQueries(cache);
                  toast.success('Project deleted');
                  setOpen(false);
                } catch (error) {
                  notifyError(error, 'Could not delete project');
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? <Spinner data-icon="inline-start" /> : null}
              Delete project
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function bytesToMegabytes(value: unknown) {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1) return '';
  const megabytes = Math.round((bytes / BYTES_PER_MB) * 1e6) / 1e6;
  return String(megabytes);
}

function megabytesToBytes(value: string) {
  const megabytes = Number(value);
  if (!Number.isFinite(megabytes) || megabytes <= 0) return null;
  const bytes = Math.round(megabytes * BYTES_PER_MB);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_QUOTA_VALUE) return null;
  return bytes;
}

function ProjectQuotas({ project }: { project: any }) {
  const configuration = useQuery({
    queryKey: ['config', project.id],
    queryFn: () => management.request<any>(`/projects/${project.id}/config`),
  });
  const write = useWrite();
  const [limits, setLimits] = useState<Record<string, string>>({
    databaseBytes: '1024',
    storageBytes: '1024',
    requestsPerMinute: '600',
  });
  useEffect(() => {
    const quotas = configuration.data?.data?.quotas;
    if (!quotas) return;
    setLimits({
      databaseBytes: bytesToMegabytes(quotas.databaseBytes ?? 1073741824),
      storageBytes: bytesToMegabytes(quotas.storageBytes ?? 1073741824),
      requestsPerMinute: String(quotas.requestsPerMinute ?? 600),
    });
  }, [configuration.data]);
  if (configuration.isPending) return <Loading />;
  return (
    <SettingsFormSection
      description="Database and reserved storage limits apply to each branch. Rate limits apply to each credential."
      title="Project quotas"
      footer={
        <Button
          disabled={write.isPending || !configuration.data}
          onClick={async () => {
            const databaseBytes = megabytesToBytes(limits.databaseBytes ?? '');
            const storageBytes = megabytesToBytes(limits.storageBytes ?? '');
            const requestsPerMinute = Number(limits.requestsPerMinute);
            if (
              databaseBytes === null ||
              storageBytes === null ||
              !Number.isSafeInteger(requestsPerMinute) ||
              requestsPerMinute < 1 ||
              requestsPerMinute > MAX_QUOTA_VALUE
            ) {
              toast.error('Enter storage limits in MB and a request rate of at least 1');
              return;
            }
            await write.mutateAsync({
              path: `/projects/${project.id}/config`,
              method: 'PUT',
              body: {
                quotas: { databaseBytes, storageBytes, requestsPerMinute },
              },
              headers: { 'if-match': String(configuration.data!.data.version) },
            });
            toast.success('Quotas saved');
          }}
        >
          {write.isPending && <Spinner data-icon="inline-start" />}
          Save Changes
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {BYTE_QUOTA_FIELDS.map(([entryName, label]) => (
          <Field key={entryName}>
            <FieldLabel htmlFor={'quota-' + entryName}>{label}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={'quota-' + entryName}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={limits[entryName] ?? ''}
                onChange={(event) => setLimits({ ...limits, [entryName]: event.target.value })}
                aria-describedby={'quota-' + entryName + '-unit'}
              />
              <InputGroupAddon align="inline-end">
                <span id={'quota-' + entryName + '-unit'}>MB</span>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        ))}
        <Field>
          <FieldLabel htmlFor="quota-requestsPerMinute">
            Requests per minute per credential
          </FieldLabel>
          <Input
            id="quota-requestsPerMinute"
            type="number"
            min="1"
            step="1"
            value={limits.requestsPerMinute ?? ''}
            onChange={(event) => setLimits({ ...limits, requestsPerMinute: event.target.value })}
          />
        </Field>
      </div>
      <ErrorMessage error={configuration.error} />
    </SettingsFormSection>
  );
}
