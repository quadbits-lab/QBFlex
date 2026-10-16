import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Building2,
  CloudUpload,
  FolderKanban,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AppFooter,
  Badge,
  Brand,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Loading,
  ShadcnButton,
  Spinner,
  toast,
  notifyError,
  cn,
} from '@qb-flex/ui';
import { management } from '../api';
import { AvatarCropDialog } from '../avatar-crop-dialog';
import { refreshStudioQueries } from '../query-client';
import { useConsole } from '../console-context';
import {
  DangerCard,
  SettingsBanner,
  SettingsFormSection,
} from './settings-layout';

type Organization = {
  id: string;
  name: string;
  image?: string | null;
  archived_at?: string | null;
  role?: string;
  created_at?: string;
};

type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  region: string;
  org_id?: string;
};

async function fileToDataUri(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

export function WorkspaceAvatar({
  organization,
  preview,
  size = 40,
  className,
}: {
  organization?: Pick<Organization, 'name' | 'image'> | null;
  preview?: string | null;
  size?: number;
  className?: string;
}) {
  const src = preview || organization?.image || '';
  const label = organization?.name ?? 'Workspace';
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted shadow-sm',
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Workspace avatar for ${label}`}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <Building2
          className="text-muted-foreground"
          style={{ width: Math.max(14, size * 0.4), height: Math.max(14, size * 0.4) }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

function ProjectCard({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted">
        <FolderKanban className="size-4 text-muted-foreground" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate font-semibold text-foreground">{project.name}</p>
        <p className="m-0 truncate font-mono text-xs text-muted-foreground">{project.slug}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={project.status === 'ready' ? 'success' : 'secondary'}>
          {project.status}
        </Badge>
        <span className="text-xs text-muted-foreground">{project.region}</span>
      </div>
    </button>
  );
}

function CreateWorkspaceCard({ onCreated }: { onCreated: (id: string) => void }) {
  const cache = useQueryClient();
  const [name, setName] = useState('');
  const write = useMutation({
    mutationFn: (body: { name: string }) =>
      management.request<{ id: string }>('/organizations', 'POST', body),
  });
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>Create a workspace</CardTitle>
        <CardDescription>
          Workspaces group projects, members, and credentials for one team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="new-workspace-name">Workspace name</FieldLabel>
          <Input
            id="new-workspace-name"
            value={name}
            maxLength={100}
            placeholder="Acme Platform"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </CardContent>
      <CardFooter>
        <Button
          disabled={write.isPending || !name.trim()}
          onClick={async () => {
            try {
              const result = await write.mutateAsync({ name: name.trim() });
              await refreshStudioQueries(cache);
              onCreated(result.data.id);
              toast.success('Workspace created');
              setName('');
            } catch (error) {
              notifyError(error, 'Could not create workspace');
            }
          }}
        >
          {write.isPending && <Spinner data-icon="inline-start" />}
          <Plus data-icon="inline-start" />
          Create workspace
        </Button>
      </CardFooter>
    </Card>
  );
}

export function WorkspaceOnboarding({ organizations }: { organizations: Organization[] }) {
  const { select } = useConsole();
  const navigate = useNavigate();
  const active = organizations.filter((organization) => !organization.archived_at);
  const archived = organizations.filter((organization) => !!organization.archived_at);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main
        id="main"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-12"
      >
        <div className="flex justify-center sm:justify-start">
          <Brand href="/" />
        </div>
        <div className="space-y-2 text-center sm:text-left">
          <h1 className="m-0 text-2xl font-semibold tracking-tight sm:text-3xl">
            Choose a workspace
          </h1>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">
            Select an existing workspace or create one to open Studio. Archived workspaces stay
            hidden until you restore them.
          </p>
        </div>

        {active.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.map((organization) => (
              <button
                key={organization.id}
                type="button"
                className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:bg-muted/30"
                onClick={() => {
                  select({ organization: organization.id, project: '', branch: 'primary' });
                  void navigate({ to: '/overview' });
                }}
              >
                <div className="flex items-center gap-3">
                  <WorkspaceAvatar organization={organization} size={44} />
                  <div className="min-w-0">
                    <p className="m-0 truncate font-semibold">{organization.name}</p>
                    <p className="m-0 text-xs text-muted-foreground capitalize">
                      {organization.role ?? 'member'}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-medium text-primary">Open workspace</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="No active workspaces">
            Create your first workspace to provision projects and data.
          </Empty>
        )}

        <CreateWorkspaceCard
          onCreated={(id) => {
            select({ organization: id, project: '', branch: 'primary' });
            void navigate({ to: '/workspace' });
          }}
        />

        {archived.length ? (
          <div className="space-y-3">
            <p className="m-0 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Archived
            </p>
            <div className="grid grid-cols-1 gap-3">
              {archived.map((organization) => (
                <div
                  key={organization.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <WorkspaceAvatar organization={organization} size={36} />
                    <div className="min-w-0">
                      <p className="m-0 truncate font-medium">{organization.name}</p>
                      <Badge variant="warning">Archived</Badge>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      select({ organization: organization.id, project: '', branch: 'primary' });
                      void navigate({ to: '/workspace' });
                    }}
                  >
                    Manage
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </main>
      <AppFooter />
    </div>
  );
}

export function WorkspaceDetails() {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const { state, select, organizations, projects } = useConsole();
  const organization = organizations.data?.data.find((o: any) => o.id === state.organization) as
    | Organization
    | undefined;
  const relevantProjects = (projects.data?.data.filter(
    (p: any) => p.org_id === state.organization,
  ) ?? []) as Project[];
  const imageRef = useRef<HTMLInputElement>(null);
  const write = useMutation({
    mutationFn: async ({
      path,
      method,
      body,
    }: {
      path: string;
      method: 'PATCH' | 'POST' | 'DELETE';
      body?: unknown;
    }) => management.request(path, method, body),
  });
  const [name, setName] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageDirty, setImageDirty] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!organization) return;
    setName(organization.name);
    setImage(organization.image ?? null);
    setImageDirty(false);
  }, [organization?.id, organization?.name, organization?.image]);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  if (!state.organization || !organization) {
    if (organizations.isPending) return <Loading />;
    return <WorkspaceOnboarding organizations={organizations.data?.data ?? []} />;
  }

  const organizationName = organization.name;
  const archivedAt = organization.archived_at ?? null;
  const canManage = organization.role === 'owner' || organization.role === 'admin';
  const canDelete = organization.role === 'owner';
  const dirty = imageDirty || (!!name.trim() && name.trim() !== organizationName);
  const preview = imageDirty ? image : organization.image;
  const deleteReady = confirmName.trim() === organizationName;

  return (
    <div className="space-y-4">
      <AvatarCropDialog
        open={cropOpen}
        imageSrc={cropSrc}
        onOpenChange={(next) => {
          setCropOpen(next);
          if (!next) {
            if (cropSrc) URL.revokeObjectURL(cropSrc);
            setCropSrc(null);
            if (imageRef.current) imageRef.current.value = '';
          }
        }}
        onConfirm={async (file) => {
          const dataUri = await fileToDataUri(file);
          setImage(dataUri);
          setImageDirty(true);
          if (cropSrc) URL.revokeObjectURL(cropSrc);
          setCropSrc(null);
          setCropOpen(false);
        }}
      />

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <WorkspaceAvatar organization={organization} preview={preview} size={56} />
          <div className="min-w-0">
            <h1 className="m-0 truncate text-2xl font-semibold tracking-tight">
              {organizationName}
            </h1>
            <p className="m-0 mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={archivedAt ? 'warning' : 'success'}>
                {archivedAt ? 'Archived' : 'Active'}
              </Badge>
              <Badge variant="secondary" className="capitalize">
                {organization.role ?? 'member'}
              </Badge>
              <span>
                {relevantProjects.length} project{relevantProjects.length === 1 ? '' : 's'}
              </span>
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={() => select({ organization: '', project: '', branch: 'primary' })}
        >
          Switch workspace
        </Button>
      </div>

      {archivedAt ? (
        <SettingsBanner>
          This workspace is archived. Restore it to show it in normal workspace selection again.
        </SettingsBanner>
      ) : null}

      <SettingsFormSection
        title="Workspace profile"
        description="Name and avatar shown in Studio selectors and details."
        footer={
          canManage ? (
            <>
              <ShadcnButton
                variant="ghost"
                disabled={write.isPending || !dirty}
                onClick={() => {
                  setName(organizationName);
                  setImage(organization.image ?? null);
                  setImageDirty(false);
                }}
              >
                Reset
              </ShadcnButton>
              <ShadcnButton
                disabled={write.isPending || !dirty || !name.trim()}
                onClick={async () => {
                  try {
                    await write.mutateAsync({
                      path: `/organizations/${organization.id}`,
                      method: 'PATCH',
                      body: { name: name.trim(), image },
                    });
                    await refreshStudioQueries(cache);
                    setImageDirty(false);
                    toast.success('Workspace profile saved');
                  } catch (error) {
                    notifyError(error, 'Could not save workspace profile');
                  }
                }}
              >
                {write.isPending && <Spinner data-icon="inline-start" />}
                Save changes
              </ShadcnButton>
            </>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <WorkspaceAvatar organization={organization} preview={preview} size={72} />
          <div className="flex min-w-0 flex-col gap-2">
            <input
              ref={imageRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={!canManage || write.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                  notifyError(new Error('Choose a PNG, JPEG, or WebP image'));
                  return;
                }
                if (file.size > 1_500_000) {
                  notifyError(new Error('Choose an image up to 1.5 MB'));
                  return;
                }
                if (cropSrc) URL.revokeObjectURL(cropSrc);
                setCropSrc(URL.createObjectURL(file));
                setCropOpen(true);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <ShadcnButton
                size="sm"
                variant="outline"
                disabled={!canManage || write.isPending}
                onClick={() => imageRef.current?.click()}
              >
                <CloudUpload data-icon="inline-start" />
                Upload avatar
              </ShadcnButton>
              {(preview || organization.image) && canManage ? (
                <ShadcnButton
                  size="sm"
                  variant="ghost"
                  disabled={write.isPending}
                  onClick={() => {
                    setImage(null);
                    setImageDirty(true);
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                  Remove
                </ShadcnButton>
              ) : null}
            </div>
            <FieldDescription>PNG, JPEG, or WebP. Crop to a square. Up to 1.5 MB.</FieldDescription>
          </div>
        </div>
        <Field>
          <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
          <Input
            id="workspace-name"
            value={name}
            maxLength={100}
            autoComplete="organization"
            disabled={!canManage}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {!canManage ? (
          <p className="m-0 text-sm text-muted-foreground">
            Only owners and admins can edit the workspace profile.
          </p>
        ) : null}
      </SettingsFormSection>

      <SettingsFormSection
        title="Projects"
        description={`${relevantProjects.length} project${relevantProjects.length === 1 ? '' : 's'} in this workspace.`}
      >
        {relevantProjects.length ? (
          <div className="grid grid-cols-1 gap-3">
            {relevantProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => {
                  select({ project: project.id, branch: 'primary' });
                  void navigate({ to: '/overview' });
                }}
              />
            ))}
          </div>
        ) : (
          <Empty title="No projects yet">Create a project from the console header.</Empty>
        )}
      </SettingsFormSection>

      {canManage ? (
        <SettingsFormSection
          title={archivedAt ? 'Restore workspace' : 'Archive workspace'}
          description={
            archivedAt
              ? 'Restore this workspace to the normal selector without deleting data.'
              : 'Hide this workspace from normal selection. Projects and data remain intact.'
          }
          footer={
            <ShadcnButton
              variant="secondary"
              disabled={write.isPending}
              onClick={async () => {
                try {
                  await write.mutateAsync({
                    path: `/organizations/${organization.id}/${archivedAt ? 'unarchive' : 'archive'}`,
                    method: 'POST',
                  });
                  await refreshStudioQueries(cache);
                  toast.success(archivedAt ? 'Workspace restored' : 'Workspace archived');
                } catch (error) {
                  notifyError(error, 'Could not update archive state');
                }
              }}
            >
              {write.isPending && <Spinner data-icon="inline-start" />}
              {archivedAt ? (
                <>
                  <ArchiveRestore data-icon="inline-start" />
                  Restore workspace
                </>
              ) : (
                <>
                  <Archive data-icon="inline-start" />
                  Archive workspace
                </>
              )}
            </ShadcnButton>
          }
        >
          <p className="m-0 text-sm text-muted-foreground">
            Archive does not remove databases, storage objects, or functions.
          </p>
        </SettingsFormSection>
      ) : null}

      {canDelete ? (
        <DangerCard
          title="Delete workspace"
          description="Permanently removes this workspace and only its projects: branch databases, function trees, storage objects under those project prefixes, keys, secrets, backups, and related audit rows. Other workspaces are not modified."
          action={
            <ShadcnButton
              variant="destructive"
              disabled={write.isPending || deleting}
              onClick={() => {
                setConfirmName('');
                setConfirmDelete(true);
              }}
            >
              <Trash2 data-icon="inline-start" />
              {deleting ? 'Deleting…' : 'Delete workspace'}
            </ShadcnButton>
          }
        />
      ) : null}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (!open) setConfirmName('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete workspace permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            Type <strong>{organizationName}</strong> to confirm. This deletes only this workspace’s
            projects, databases, storage files, functions, keys, secrets, and backups. Other
            workspaces stay untouched. This cannot be undone.
          </AlertDialogDescription>
          <Field>
            <FieldLabel htmlFor="confirm-workspace-delete">Workspace name</FieldLabel>
            <Input
              id="confirm-workspace-delete"
              value={confirmName}
              autoComplete="off"
              placeholder={organizationName}
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || !deleteReady}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleteReady) return;
                setDeleting(true);
                try {
                  await management.request(`/organizations/${organization.id}`, 'DELETE');
                  await cache.cancelQueries();
                  await cache.clear();
                  select({ organization: '', project: '', branch: 'primary' });
                  toast.success('Workspace deleted');
                  setConfirmDelete(false);
                } catch (error) {
                  notifyError(error, 'Could not delete workspace');
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? <Spinner data-icon="inline-start" /> : null}
              Delete workspace
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
