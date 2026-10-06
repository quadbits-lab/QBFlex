import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Empty,
  Input,
  Loading,
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
  Textarea,
  toast,
} from '@qb-flex/ui';
import { management } from '../api';
import { ErrorMessage, useWrite } from './shared';
import { SettingsBanner, SettingsPanel, SettingsSection, SettingsSectionGroup } from './settings-layout';

export function AuthWorkspace({ base, project }: { base: string; project: any }) {
  const users = useUsers(base);
  const write = useWrite();
  return (
    <div className="flex flex-col gap-8">
      <SettingsPanel
        description="Separate from platform accounts; scoped to this branch."
        title="Application users"
      >
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
                Use the client SDK to register your first application user.
              </Empty>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Sessions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.data.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{u.id}</TableCell>
                    <TableCell>
                      {u.emailVerified ? (
                        <Badge variant="success">verified</Badge>
                      ) : (
                        <Badge>pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        disabled={write.isPending}
                        onClick={async () => {
                          await write.mutateAsync({
                            path: base + '/users/' + u.id + '/sessions',
                            method: 'DELETE',
                          });
                          toast.success('Sessions revoked for ' + u.email);
                        }}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SettingsPanel>
      <ProviderSettings project={project} />
    </div>
  );
}

function useUsers(base: string) {
  return useUsersQuery(base);
}
function useUsersQuery(base: string) {
  return useQuery({
    queryKey: ['users', base],
    queryFn: () => management.request<any[]>(base + '/users'),
  });
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
  return (
    <div className="flex flex-col gap-8">
      <SettingsBanner>
        {(config.data?.data.providers?.length ?? 0) + ' configured social providers'}
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
