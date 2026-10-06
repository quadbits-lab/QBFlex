import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CloudUpload,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Mail,
  Shield,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  Badge,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShadcnButton,
  Spinner,
  cn,
  notifyError,
  toast,
} from '@qb-flex/ui';
import { apiURL, management, raw } from '../api';
import { AvatarCropDialog } from '../avatar-crop-dialog';
import { DangerCard, SettingsFieldGroup, SettingsFormSection } from './settings-layout';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const MAX_BYTES = 3_145_728;

const PASSWORD_RULES = [
  { id: 'length', label: 'At least 12 characters', test: (v: string) => v.length >= 12 },
  { id: 'lower', label: 'At least 1 lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { id: 'upper', label: 'At least 1 uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'number', label: 'At least 1 number', test: (v: string) => /\d/.test(v) },
  {
    id: 'special',
    label: 'At least 1 special character',
    test: (v: string) => /[^A-Za-z0-9]/.test(v),
  },
] as const;

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

export function UserAvatar({
  user,
  className,
  size = 'md',
}: {
  user: { name?: string; image?: string | null };
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: 'size-8 text-xs',
    md: 'size-10 text-sm',
    lg: 'size-16 text-lg',
  } as const;
  if (user.image) {
    return (
      <img
        alt=""
        className={cn('shrink-0 rounded-full object-cover', sizes[size], className)}
        src={user.image.startsWith('http') ? user.image : apiURL + user.image}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full border border-border bg-muted font-medium',
        sizes[size],
        className,
      )}
    >
      {user.name?.[0]?.toUpperCase() ?? <UserRound className="size-4" />}
    </span>
  );
}

function PasswordStrength({ value }: { value: string }) {
  const passed = PASSWORD_RULES.map((rule) => rule.test(value));
  const score = passed.filter(Boolean).length;
  const segments = 4;
  const filled = Math.min(segments, Math.round((score / PASSWORD_RULES.length) * segments));
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-xs font-medium text-muted-foreground">Password strength</p>
        <p className="m-0 text-xs text-muted-foreground">
          {score}/{PASSWORD_RULES.length} checks
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {Array.from({ length: segments }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1.5 rounded-full bg-border',
              index < filled &&
                (filled <= 1
                  ? 'bg-destructive'
                  : filled <= 2
                    ? 'bg-amber-500'
                    : filled <= 3
                      ? 'bg-lime-500'
                      : 'bg-emerald-500'),
            )}
          />
        ))}
      </div>
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {PASSWORD_RULES.map((rule, index) => {
          const ok = passed[index]!;
          return (
            <li
              key={rule.id}
              className={cn(
                'flex items-center gap-2 text-xs',
                ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded-full',
                  ok ? 'bg-emerald-500/15' : 'bg-destructive/10',
                )}
              >
                {ok ? (
                  <Check className="size-2.5" aria-hidden="true" />
                ) : (
                  <X className="size-2.5 text-destructive/80" aria-hidden="true" />
                )}
              </span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AccountProfilePanel({ organizationId }: { organizationId?: string }) {
  const cache = useQueryClient();
  const session = useQuery({
    queryKey: ['platform-session'],
    queryFn: () => raw('/platform/auth/get-session'),
  });
  const members = useQuery({
    queryKey: ['members', organizationId],
    enabled: !!organizationId,
    queryFn: () => management.request<any[]>(`/organizations/${organizationId}/members`),
  });
  const accounts = useQuery({
    queryKey: ['platform-accounts'],
    queryFn: () => raw('/platform/auth/list-accounts'),
  });
  const user = session.data?.user as
    | { id: string; name: string; email: string; image?: string | null }
    | undefined;
  const membership = (members.data?.data ?? []).find((m: any) => m.user_id === user?.id);
  const input = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!user) return;
    const parts = splitName(user.name);
    setFirstName(parts.first);
    setLastName(parts.last);
  }, [user?.id, user?.name]);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!ACCEPT.split(',').includes(file.type) && file.type !== 'image/png')
        throw new Error('Use a JPEG, PNG, WebP, or GIF image');
      if (file.size > MAX_BYTES) throw new Error('Pick a photo up to 3MB');
      const body = new FormData();
      body.append('file', file, file.name || 'avatar.png');
      const response = await fetch(apiURL + '/platform/avatar', {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(value.error?.message ?? value.message ?? 'Avatar upload failed');
      return value.data as { image: string };
    },
    onSuccess: async () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
      setCropOpen(false);
      await cache.invalidateQueries({ queryKey: ['platform-session'] });
      toast.success('Avatar updated');
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const response = await fetch(apiURL + '/platform/avatar', {
        method: 'DELETE',
        credentials: 'include',
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(value.error?.message ?? value.message ?? 'Unable to remove avatar');
      return value.data;
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['platform-session'] });
      toast.success('Avatar removed');
    },
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      const name = [firstName, lastName].map((part) => part.trim()).filter(Boolean).join(' ');
      if (!name) throw new Error('Enter a name');
      return raw('/platform/auth/update-user', 'POST', { name });
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['platform-session'] });
      toast.success('Profile saved');
    },
  });

  const savePassword = useMutation({
    mutationFn: async () => {
      if (!PASSWORD_RULES.every((rule) => rule.test(newPassword)))
        throw new Error('Choose a stronger password');
      return raw('/platform/auth/change-password', 'POST', {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Password updated');
    },
  });

  const revokeSessions = useMutation({
    mutationFn: () => raw('/platform/auth/revoke-other-sessions', 'POST', {}),
    onSuccess: () => toast.success('Signed out of other sessions'),
  });

  const linked = useMemo(() => {
    const rows = accounts.data?.data ?? accounts.data ?? [];
    return Array.isArray(rows) ? rows : [];
  }, [accounts.data]);

  if (!user) return null;
  const busy = upload.isPending || remove.isPending;
  const shown = user.image
    ? user.image.startsWith('http')
      ? user.image
      : apiURL + user.image
    : null;
  const passwordReady =
    currentPassword.length > 0 && PASSWORD_RULES.every((rule) => rule.test(newPassword));
  const role = membership?.role ?? 'member';

  return (
    <div className="space-y-4">
      <AvatarCropDialog
        open={cropOpen}
        imageSrc={cropSrc}
        pending={upload.isPending}
        onOpenChange={(next) => {
          setCropOpen(next);
          if (!next) {
            if (cropSrc) URL.revokeObjectURL(cropSrc);
            setCropSrc(null);
            if (input.current) input.current.value = '';
          }
        }}
        onConfirm={async (file) => {
          await upload.mutateAsync(file);
        }}
      />
      <SettingsFormSection
        title="Personal Information"
        description="Update how you appear across Studio and audit events."
        footer={
          <ShadcnButton
            disabled={saveProfile.isPending || !firstName.trim()}
            onClick={() => saveProfile.mutate()}
          >
            {saveProfile.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save Changes
          </ShadcnButton>
        }
      >
        <SettingsFieldGroup
          description="JPEG, PNG, WebP, or GIF up to 3MB. Crop to a square before saving."
          title="Your Avatar"
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid size-16 place-items-center overflow-hidden rounded-full border border-border bg-muted shadow-sm">
              {shown ? (
                <img alt="" className="size-full object-cover" src={shown} />
              ) : (
                <UserRound className="size-6 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={input}
                  accept={ACCEPT}
                  className="sr-only"
                  disabled={busy}
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (!ACCEPT.split(',').includes(file.type)) {
                      notifyError('Use a JPEG, PNG, WebP, or GIF image');
                      return;
                    }
                    if (file.size > MAX_BYTES) {
                      notifyError('Pick a photo up to 3MB');
                      return;
                    }
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setCropSrc(URL.createObjectURL(file));
                    setCropOpen(true);
                  }}
                />
                <ShadcnButton
                  disabled={busy}
                  size="sm"
                  variant="outline"
                  onClick={() => input.current?.click()}
                >
                  <CloudUpload data-icon="inline-start" />
                  Upload avatar
                </ShadcnButton>
                {user.image ? (
                  <ShadcnButton
                    aria-label="Remove avatar"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    size="icon"
                    variant="outline"
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? <Spinner /> : <Trash2 />}
                  </ShadcnButton>
                ) : null}
              </div>
              <p className="m-0 text-xs text-muted-foreground">
                Choose a photo, crop it, then save. Max 3MB.
              </p>
            </div>
          </div>
        </SettingsFieldGroup>

        <div className="h-px bg-border" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="first-name">First Name</FieldLabel>
            <Input
              id="first-name"
              placeholder="John"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="last-name">Last Name</FieldLabel>
            <Input
              id="last-name"
              placeholder="Doe"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="account-email-display">Email</FieldLabel>
            <div className="relative">
              <Input id="account-email-display" readOnly value={user.email} className="pr-10" />
              <Mail
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="account-role">Organization role</FieldLabel>
            <Select value={role} disabled>
              <SelectTrigger id="account-role">
                <SelectValue placeholder="Organization role" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {['owner', 'admin', 'developer', 'viewer', 'member'].map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SettingsFormSection>

      <SettingsFormSection
        title="Email & Password"
        description="Change your sign-in password. Other sessions are revoked after a successful update."
        footer={
          <ShadcnButton
            disabled={savePassword.isPending || !passwordReady}
            onClick={() => savePassword.mutate()}
          >
            {savePassword.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save Changes
          </ShadcnButton>
        }
      >
        <Field>
          <FieldLabel htmlFor="password-email">
            Email <span className="text-destructive">*</span>
          </FieldLabel>
          <div className="relative">
            <Input
              id="password-email"
              readOnly
              value={user.email}
              className="pr-10"
              placeholder="Email address"
            />
            <Mail
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="current-password">
              Current Password <span className="text-destructive">*</span>
            </FieldLabel>
            <div className="relative">
              <Input
                id="current-password"
                autoComplete="current-password"
                className="pr-10"
                placeholder="Password"
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <button
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => setShowCurrent((value) => !value)}
              >
                {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">
              New Password <span className="text-destructive">*</span>
            </FieldLabel>
            <div className="relative">
              <Input
                id="new-password"
                autoComplete="new-password"
                className="pr-10"
                placeholder="Password"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <button
                aria-label={showNew ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => setShowNew((value) => !value)}
              >
                {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        </div>
        <PasswordStrength value={newPassword} />
      </SettingsFormSection>

      <SettingsFormSection
        title="Connect Accounts"
        description="Sign-in methods linked to this platform account."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(linked.length ? linked : [{ providerId: 'credential', id: 'credential' }]).map(
            (account: any) => {
              const provider = String(account.providerId ?? 'account');
              return (
                <div
                  key={account.id ?? account.accountId ?? provider}
                  className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background">
                    {provider === 'credential' ? (
                      <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-medium capitalize">{provider}</p>
                    <p className="m-0 truncate text-xs text-muted-foreground">
                      {provider === 'credential' ? 'Email and password' : 'Linked identity'}
                    </p>
                  </div>
                  <Badge variant="success">Connected</Badge>
                </div>
              );
            },
          )}
        </div>
        <p className="m-0 text-xs text-muted-foreground">
          OAuth providers appear here when configured for this installation.
        </p>
      </SettingsFormSection>

      <SettingsFormSection
        tone="danger"
        title="Danger Zone"
        description={
          <>
            These actions affect active sessions across devices. They do not delete your account or
            project data.{' '}
            <a
              className="font-medium text-foreground underline underline-offset-2"
              href="https://www.better-auth.com/docs/concepts/users-accounts"
              rel="noopener noreferrer"
              target="_blank"
            >
              Learn more
            </a>
          </>
        }
      >
        <DangerCard
          title="Sign out other sessions"
          description="Revoke every active platform session except this browser."
          action={
            <ShadcnButton
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={revokeSessions.isPending}
              variant="outline"
              onClick={() => revokeSessions.mutate()}
            >
              {revokeSessions.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <LogOut data-icon="inline-start" />
              )}
              Sign out others
            </ShadcnButton>
          }
        />
      </SettingsFormSection>
    </div>
  );
}
