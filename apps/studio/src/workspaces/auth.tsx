import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  Field,
  FieldLabel,
  Input,
  Loading,
  Modal,
  ShadcnButton,
  Select,
  SelectContent,
  SelectGroup,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@qb-flex/ui';
import { management } from '../api';
import { ErrorMessage, useWrite } from './shared';
import {
  SettingsBanner,
  SettingsPanel,
  SettingsSection,
  SettingsSectionGroup,
} from './settings-layout';

type AppUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string;
  banned: boolean;
  banReason: string | null;
  roles: string[];
};

type AppRole = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  members: number;
};

export function AuthWorkspace({ base, project }: { base: string; project: any }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <Badge variant="success">Magic links available</Badge>
        <p className="m-0">
          Application magic links and passkeys are supported on this branch. Magic links use the
          configured mail adapter and do not sign in to Studio. Studio stays on password, passkey
          and authenticator.
        </p>
      </div>
      <Tabs defaultValue="users" className="flex flex-col gap-6">
      <TabsList aria-label="Authentication sections" className="w-fit">
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
        <TabsTrigger value="providers">Providers</TabsTrigger>
      </TabsList>
      <TabsContent value="users" className="mt-0 outline-none">
        <UsersPanel base={base} />
      </TabsContent>
      <TabsContent value="roles" className="mt-0 outline-none">
        <RolesPanel base={base} />
      </TabsContent>
      <TabsContent value="providers" className="mt-0 outline-none">
        <ProviderSettings project={project} />
      </TabsContent>
    </Tabs>
    </div>
  );
}

function useUsers(base: string) {
  return useQuery({
    queryKey: ['users', base],
    queryFn: () => management.request<AppUser[]>(base + '/users'),
  });
}

function useRoles(base: string) {
  return useQuery({
    queryKey: ['roles', base],
    queryFn: () => management.request<AppRole[]>(base + '/roles'),
  });
}

function UsersPanel({ base }: { base: string }) {
  const users = useUsers(base);
  const roles = useRoles(base);
  const write = useWrite();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [rolesUser, setRolesUser] = useState<AppUser | null>(null);
  const [banUser, setBanUser] = useState<AppUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [banReason, setBanReason] = useState('');

  const filtered = useMemo(() => {
    const list = users.data?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name ?? '').toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        u.roles.some((r) => r.includes(q)),
    );
  }, [users.data?.data, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Application users</h2>
          <p className="text-sm text-muted-foreground">
            Branch-scoped end users. Separate from platform Studio accounts.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          Create user
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search users"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {users.isPending ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : users.error ? (
          <div className="p-4">
            <ErrorMessage error={users.error} />
          </div>
        ) : !users.data?.data.length ? (
          <div className="p-6">
            <Empty title="No application users yet">
              Create a user here or register one with the client SDK.
            </Empty>
          </div>
        ) : !filtered.length ? (
          <div className="p-6">
            <Empty title="No matching users">Try a different search.</Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{u.name || u.email}</span>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{u.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length ? (
                        u.roles.map((r) => (
                          <Badge key={r} variant="secondary">
                            {r}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">authenticated</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.emailVerified ? (
                      <Badge variant="success">verified</Badge>
                    ) : (
                      <Badge>pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.banned ? (
                      <Badge variant="destructive">blocked</Badge>
                    ) : (
                      <Badge variant="success">active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <ShadcnButton
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${u.email}`}
                        >
                          <MoreHorizontal />
                        </ShadcnButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditUser(u)}>
                          Edit profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setRolesUser(u)}>
                          Change roles
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={write.isPending}
                          onClick={async () => {
                            await write.mutateAsync({
                              path: base + '/users/' + u.id + '/sessions',
                              method: 'DELETE',
                            });
                            toast.success('Sessions revoked for ' + u.email);
                          }}
                        >
                          Revoke sessions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {u.banned ? (
                          <DropdownMenuItem
                            disabled={write.isPending}
                            onClick={async () => {
                              await write.mutateAsync({
                                path: base + '/users/' + u.id + '/ban',
                                method: 'DELETE',
                              });
                              toast.success('User unblocked');
                            }}
                          >
                            Unblock
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => {
                              setBanReason('');
                              setBanUser(u);
                            }}
                          >
                            Block
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteUser(u)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <CreateUserModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        base={base}
        roles={roles.data?.data ?? []}
      />
      <EditUserModal
        open={!!editUser}
        onOpenChange={(v) => !v && setEditUser(null)}
        base={base}
        user={editUser}
      />
      <ChangeRolesModal
        open={!!rolesUser}
        onOpenChange={(v) => !v && setRolesUser(null)}
        base={base}
        user={rolesUser}
        roles={roles.data?.data ?? []}
      />

      <AlertDialog open={!!banUser} onOpenChange={(v) => !v && setBanUser(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Block {banUser?.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Blocked users cannot sign in. Active sessions are revoked immediately.
          </AlertDialogDescription>
          <Field className="mt-2">
            <FieldLabel htmlFor="ban-reason">Reason (optional)</FieldLabel>
            <Input
              id="ban-reason"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Policy violation"
            />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={write.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!banUser) return;
                await write.mutateAsync({
                  path: base + '/users/' + banUser.id + '/ban',
                  method: 'POST',
                  body: { reason: banReason || undefined },
                });
                toast.success('User blocked');
                setBanUser(null);
              }}
            >
              Block user
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteUser} onOpenChange={(v) => !v && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete {deleteUser?.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the user, sessions, and role assignments from this branch.
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={write.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteUser) return;
                await write.mutateAsync({
                  path: base + '/users/' + deleteUser.id,
                  method: 'DELETE',
                });
                toast.success('User deleted');
                setDeleteUser(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateUserModal({
  open,
  onOpenChange,
  base,
  roles,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  base: string;
  roles: AppRole[];
}) {
  const write = useWrite();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setName('');
      setEmailVerified(false);
      setSelected([]);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create application user"
      description="Creates an email/password user on this branch."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await write.mutateAsync({
            path: base + '/users',
            method: 'POST',
            body: {
              email,
              password,
              name: name || undefined,
              emailVerified,
              roles: selected,
            },
          });
          toast.success('User created');
          onOpenChange(false);
        }}
      >
        <Field>
          <FieldLabel htmlFor="create-email">Email</FieldLabel>
          <Input
            id="create-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="create-name">Name</FieldLabel>
          <Input id="create-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="create-password">Password</FieldLabel>
          <Input
            id="create-password"
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch checked={emailVerified} onCheckedChange={setEmailVerified} />
          Mark email as verified
        </label>
        <RoleChecklist roles={roles} selected={selected} onChange={setSelected} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={write.isPending || !email || password.length < 12}>
            {write.isPending && <Spinner data-icon="inline-start" />}
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  open,
  onOpenChange,
  base,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  base: string;
  user: AppUser | null;
}) {
  const write = useWrite();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setName(user.name ?? '');
      setEmailVerified(user.emailVerified);
    }
  }, [user]);
  if (!user) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Edit profile" description={user.email}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await write.mutateAsync({
            path: base + '/users/' + user.id,
            method: 'PATCH',
            body: { email, name, emailVerified },
          });
          toast.success('Profile updated');
          onOpenChange(false);
        }}
      >
        <Field>
          <FieldLabel htmlFor="edit-email">Email</FieldLabel>
          <Input
            id="edit-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-name">Name</FieldLabel>
          <Input id="edit-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch checked={emailVerified} onCheckedChange={setEmailVerified} />
          Email verified
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={write.isPending}>
            {write.isPending && <Spinner data-icon="inline-start" />}
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ChangeRolesModal({
  open,
  onOpenChange,
  base,
  user,
  roles,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  base: string;
  user: AppUser | null;
  roles: AppRole[];
}) {
  const write = useWrite();
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (user) setSelected([...user.roles]);
  }, [user]);
  if (!user) return null;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Change roles"
      description={`Assign application roles for ${user.email}.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await write.mutateAsync({
            path: base + '/users/' + user.id + '/roles',
            method: 'PUT',
            body: { roles: selected },
          });
          toast.success('Roles updated');
          onOpenChange(false);
        }}
      >
        <RoleChecklist roles={roles} selected={selected} onChange={setSelected} />
        {!roles.length && (
          <p className="text-sm text-muted-foreground">
            Create roles in the Roles tab before assigning them.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={write.isPending}>
            {write.isPending && <Spinner data-icon="inline-start" />}
            Save roles
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RoleChecklist({
  roles,
  selected,
  onChange,
}: {
  roles: AppRole[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  if (!roles.length) return null;
  return (
    <Field>
      <FieldLabel>Roles</FieldLabel>
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        {roles.map((r) => {
          const checked = selected.includes(r.name);
          return (
            <label key={r.id} className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(v) =>
                  onChange(
                    v === true ? [...selected, r.name] : selected.filter((n) => n !== r.name),
                  )
                }
              />
              <span>
                <span className="font-medium">{r.name}</span>
                {r.description ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {r.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </Field>
  );
}

function RolesPanel({ base }: { base: string }) {
  const roles = useRoles(base);
  const write = useWrite();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<AppRole | null>(null);
  const [deleteRole, setDeleteRole] = useState<AppRole | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Application roles</h2>
          <p className="text-sm text-muted-foreground">
            Named roles for this branch. Use them in Database policies alongside anonymous,
            authenticated, and service.
          </p>
        </div>
        <Button
          onClick={() => {
            setName('');
            setDescription('');
            setCreateOpen(true);
          }}
        >
          <Plus data-icon="inline-start" />
          Create role
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {roles.isPending ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : roles.error ? (
          <div className="p-4">
            <ErrorMessage error={roles.error} />
          </div>
        ) : !roles.data?.data.length ? (
          <div className="p-6">
            <Empty title="No custom roles yet">
              Create roles such as editor or moderator, then assign them to users and reference them
              in policies.
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Members</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.description || '—'}
                  </TableCell>
                  <TableCell>{r.members}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditRole(r);
                          setName(r.name);
                          setDescription(r.description ?? '');
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => setDeleteRole(r)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create role"
        description="Lowercase letters, numbers, and underscores. Reserved: anonymous, authenticated, service."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await write.mutateAsync({
              path: base + '/roles',
              method: 'POST',
              body: { name, description },
            });
            toast.success('Role created');
            setCreateOpen(false);
          }}
        >
          <Field>
            <FieldLabel htmlFor="role-name">Name</FieldLabel>
            <Input
              id="role-name"
              required
              pattern="[a-z][a-z0-9_]{0,62}"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="editor"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="role-description">Description</FieldLabel>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={write.isPending || !name}>
              {write.isPending && <Spinner data-icon="inline-start" />}
              Create
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editRole}
        onOpenChange={(v) => !v && setEditRole(null)}
        title="Edit role"
        description={editRole?.name}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editRole) return;
            await write.mutateAsync({
              path: base + '/roles/' + editRole.id,
              method: 'PATCH',
              body: { name, description },
            });
            toast.success('Role updated');
            setEditRole(null);
          }}
        >
          <Field>
            <FieldLabel htmlFor="edit-role-name">Name</FieldLabel>
            <Input
              id="edit-role-name"
              required
              pattern="[a-z][a-z0-9_]{0,62}"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-role-description">Description</FieldLabel>
            <Input
              id="edit-role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditRole(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={write.isPending || !name}>
              {write.isPending && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <AlertDialog open={!!deleteRole} onOpenChange={(v) => !v && setDeleteRole(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete role {deleteRole?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Assignments are removed. Policies that still reference this role name will fail
            validation on save until updated.
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={write.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteRole) return;
                await write.mutateAsync({
                  path: base + '/roles/' + deleteRole.id,
                  method: 'DELETE',
                });
                toast.success('Role deleted');
                setDeleteRole(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProviderSettings({ project }: { project: any }) {
  const config = useQuery({
    queryKey: ['config', project.id],
    queryFn: () => management.request<any>(`/projects/${project.id}/config`),
  });
  const [provider, setProvider] = useState('github');
  const [clientId, setClientID] = useState('');
  const [secret, setSecret] = useState('');
  const [origins, setOrigins] = useState('');
  const [verify, setVerify] = useState(false);
  const write = useWrite();
  useEffect(() => {
    if (config.data) {
      setOrigins((config.data.data.origins ?? []).join('\n'));
      setVerify(Boolean(config.data.data.verifyEmail));
    }
  }, [config.data]);
  const providers: string[] = config.data?.data.providers ?? [];
  return (
    <div className="flex flex-col gap-8">
      <SettingsBanner>
        {providers.length
          ? `Configured: ${providers.join(', ')}`
          : 'No social providers configured'}
      </SettingsBanner>
      <SettingsPanel
        description="Origins, email verification, and social sign-in for application users."
        title="Authentication configuration"
      >
        <SettingsSectionGroup>
          <SettingsSection
            description="Verification and reset emails render as React Email templates and send through Resend."
            title="Email verification"
          >
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <Switch
                checked={verify}
                onCheckedChange={setVerify}
                aria-label="Require email verification"
              />
              Require email verification
            </label>
          </SettingsSection>
          <SettingsSection
            description="One exact origin per line. Used for CORS and OAuth redirects."
            title="Allowed application origins"
          >
            <Textarea
              id="app-origins"
              className="min-h-20 font-mono text-xs"
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
              placeholder="One exact origin per line"
            />
          </SettingsSection>
          <SettingsSection title="Save auth settings">
            <Button
              className="w-fit"
              variant="ghost"
              disabled={write.isPending}
              onClick={async () => {
                await write.mutateAsync({
                  path: `/projects/${project.id}/config`,
                  method: 'PUT',
                  headers: { 'if-match': String(config.data?.data.version) },
                  body: {
                    origins: origins
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                    verifyEmail: verify,
                  },
                });
                toast.success('Authentication settings saved');
              }}
            >
              {write.isPending && <Spinner data-icon="inline-start" />}
              Save auth settings
            </Button>
          </SettingsSection>
        </SettingsSectionGroup>
      </SettingsPanel>

      <SettingsPanel
        description="Credentials are encrypted and never shown again. Register the explicit branch callback URL with the provider."
        title="Social provider"
      >
        <SettingsSectionGroup>
          <SettingsSection title="Provider">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="provider" className="max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsSection>
          <SettingsSection title="Client ID">
            <Input
              id="provider-client-id"
              className="max-w-md"
              value={clientId}
              onChange={(e) => setClientID(e.target.value)}
            />
          </SettingsSection>
          <SettingsSection title="Client secret">
            <Input
              id="provider-secret"
              className="max-w-md"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
            />
          </SettingsSection>
          <SettingsSection title="Save provider">
            <div className="flex flex-col gap-3">
              <Button
                className="w-fit"
                disabled={!clientId || !secret || write.isPending}
                onClick={async () => {
                  await write.mutateAsync({
                    path: `/projects/${project.id}/config`,
                    method: 'PUT',
                    headers: { 'if-match': String(config.data?.data.version) },
                    body: { providers: { [provider]: { clientId, clientSecret: secret } } },
                  });
                  toast.success(provider + ' provider saved');
                  setSecret('');
                  setClientID('');
                }}
              >
                {write.isPending && <Spinner data-icon="inline-start" />}
                Save provider
              </Button>
            </div>
          </SettingsSection>
        </SettingsSectionGroup>
      </SettingsPanel>
    </div>
  );
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}
