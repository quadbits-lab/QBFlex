import { createFileRoute } from '@tanstack/react-router';
import { Zap, ShieldCheck, Radio, ArrowUpRight } from 'lucide-react';
import { useConsole } from '../../console-context';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  ShadcnButton,
} from '@qb-flex/ui';
import { docsURL } from '../../api';
import { WorkspaceHeader, NoProject } from '../../workspace-header';
function RealtimeRoute() {
  const { project } = useConsole();
  return (
    <div className="flex flex-col gap-4">
      <WorkspaceHeader
        view="Realtime"
        hint="Keep your application in sync with authorized row events."
        project={project}
      />
      {project ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                icon: Zap,
                name: 'Committed changes',
                detail: 'Events follow successful database writes.',
              },
              {
                icon: ShieldCheck,
                name: 'Policy protected',
                detail: 'Subscribers only receive rows they can read.',
              },
              {
                icon: Radio,
                name: 'Live subscriptions',
                detail: 'Connect through the application WebSocket endpoint.',
              },
            ].map((s) => (
              <Card key={s.name}>
                <CardHeader>
                  <s.icon className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
                  <CardTitle>{s.name}</CardTitle>
                  <CardDescription>{s.detail}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Subscribe to row events</CardTitle>
                <Badge variant="outline">Single node</Badge>
              </div>
              <CardDescription>
                Use the JavaScript SDK to refresh your application when data changes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="m-0 overflow-auto font-mono text-xs">{`const channel = qb.channel({\n  table: 'tasks',\n  onEvent: () => refreshTasks(),\n}).subscribe();\n\n// Clean up when the view unmounts.\nchannel.unsubscribe();`}</pre>
            </CardContent>
            <CardFooter>
              <ShadcnButton variant="outline" asChild>
                <a href={docsURL + '/docs/realtime/row-events'}>
                  Read the realtime guide
                  <ArrowUpRight data-icon="inline-end" />
                </a>
              </ShadcnButton>
            </CardFooter>
          </Card>
        </>
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/realtime')({ component: RealtimeRoute });
