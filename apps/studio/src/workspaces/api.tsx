import { useState } from 'react';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { Check, Copy, Download, KeyRound, Plus } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  ShadcnButton,
  Spinner,
  toast,
} from '@qb-flex/ui';
import { management, docsURL, apiURL } from '../api';
import { download, useWrite } from './shared';
import {
  SettingsBanner,
  SettingsPanel,
  SettingsSection,
  SettingsSectionGroup,
} from './settings-layout';

export function APIWorkspace({
  base,
  project,
  keyValue,
  setKeyValue,
}: {
  base: string;
  project: any;
  keyValue: string;
  setKeyValue: (v: string) => void;
}) {
  const keys = useReactQuery({
    queryKey: ['keys', project.id],
    queryFn: () => management.request<any[]>(`/projects/${project.id}/keys`),
  });
  const write = useWrite();
  const [types, setTypes] = useState('');
  const [copied, setCopied] = useState(false);
  const branchId = base.split('/').pop() ?? 'primary';
  const endpoint = `${apiURL}/v1/projects/${project.id}/branches/${branchId}`;
  return (
    <div className="flex flex-col gap-8">
      <SettingsBanner
        actions={
          <>
            <ShadcnButton variant="outline" size="sm" asChild>
              <a href={docsURL + '/docs/sdk/react/quickstart'}>React tutorial</a>
            </ShadcnButton>
            <ShadcnButton variant="outline" size="sm" asChild>
              <a href={docsURL + '/docs/sdk/vanilla/quickstart'}>Vanilla JS tutorial</a>
            </ShadcnButton>
          </>
        }
      >
        REST v1 — publishable keys identify the project; policies decide access.
      </SettingsBanner>

      <SettingsPanel
        description="Copy these values into your application client."
        title="Connect your application"
      >
        <SettingsSectionGroup>
          <SettingsSection
            description="Branch-scoped Management and application API base."
            title="API endpoint"
          >
            <Input id="api-endpoint" className="font-mono text-xs" value={endpoint} readOnly />
          </SettingsSection>
          <SettingsSection
            description="Starter client configuration for this project."
            title="SDK snippet"
          >
            <pre className="overflow-auto rounded-lg border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed">
              {`import { createClient } from '@qb-flex/client';\n\nconst qb = createClient({\n  url: '${apiURL}',\n  projectId: '${project.id}',\n  branch: '${branchId}',\n  publishableKey: 'YOUR_PUBLISHABLE_KEY',\n});`}
            </pre>
          </SettingsSection>
        </SettingsSectionGroup>
      </SettingsPanel>

      <SettingsPanel
        description="Create one key per application or environment."
        title="Publishable keys"
      >
        <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card">
          {keyValue && (
            <div className="border-b border-border p-4">
              <Alert>
                <KeyRound aria-hidden="true" />
                <AlertTitle>Copy this key now</AlertTitle>
                <AlertDescription>Its value is shown once.</AlertDescription>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all whitespace-normal">{keyValue}</code>
                  <ShadcnButton
                    variant="ghost"
                    size="icon"
                    aria-label="Copy key"
                    onClick={async () => {
                      await navigator.clipboard.writeText(keyValue);
                      setCopied(true);
                      toast.success('Key copied to clipboard');
                    }}
                  >
                    {copied ? <Check /> : <Copy />}
                  </ShadcnButton>
                </div>
              </Alert>
            </div>
          )}
          {keys.data?.data.map((k: any) => (
            <div
              className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
              key={k.id}
            >
              <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <code className="font-mono text-xs">{k.prefix}…</code>
              <Badge variant={k.revoked_at ? 'destructive' : 'success'}>
                {k.revoked_at ? 'Revoked' : 'Active'}
              </Badge>
              <Button
                variant="ghost"
                className="ml-auto"
                disabled={!!k.revoked_at}
                onClick={async () => {
                  await write.mutateAsync({
                    path: `/projects/${project.id}/keys/${k.id}`,
                    method: 'DELETE',
                  });
                  toast.success('Key revoked');
                }}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
        <SettingsSectionGroup>
          <SettingsSection
            description="Publishable keys identify this project. Policies determine data access."
            title="Create key"
          >
            <div className="flex flex-col gap-3">
              <Button
                className="w-fit"
                onClick={async () => {
                  const result = await write.mutateAsync({
                    path: `/projects/${project.id}/keys`,
                    body: {},
                  });
                  setKeyValue(result.data.key);
                  toast.success('Publishable key created');
                }}
                disabled={write.isPending}
              >
                {write.isPending && <Spinner data-icon="inline-start" />}
                <Plus data-icon="inline-start" /> Create key
              </Button>
            </div>
          </SettingsSection>
        </SettingsSectionGroup>
      </SettingsPanel>

      <SettingsPanel
        description="Typed row shapes generated from the branch schema."
        title="Generated TypeScript definitions"
      >
        <SettingsSectionGroup>
          <SettingsSection title="Generate types">
            <div className="flex flex-col gap-3">
              <ShadcnButton
                className="w-fit"
                variant="outline"
                onClick={async () => {
                  const value = await management.text(base + '/types');
                  setTypes(value);
                  download(value, 'qb-flex.types.ts');
                  toast.success('Types downloaded');
                }}
              >
                <Download data-icon="inline-start" /> Generate types
              </ShadcnButton>
              {types && (
                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed">
                  {types}
                </pre>
              )}
            </div>
          </SettingsSection>
        </SettingsSectionGroup>
      </SettingsPanel>
    </div>
  );
}
