import { createFileRoute } from '@tanstack/react-router';
import { Box, ArrowUpRight } from 'lucide-react';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject } from '../../workspace-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  ShadcnEmpty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  ShadcnButton,
} from '@qb-flex/ui';
import { docsURL } from '../../api';
function FunctionsRoute() {
  const { project } = useConsole();
  return (
    <div className="flex flex-col gap-4">
      <WorkspaceHeader
        view="Functions"
        hint="Run server-side application logic in isolated environments."
        project={project}
      />
      {project ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Functions</CardTitle>
              <Badge variant="outline">Planned · P1</Badge>
            </div>
            <CardDescription>This capability is on the roadmap.</CardDescription>
          </CardHeader>
          <CardContent>
            <ShadcnEmpty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Box aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Coming to your workspace</EmptyTitle>
                <EmptyDescription>
                  Run server-side application logic in isolated environments. This feature is not
                  enabled in the current release.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className="flex flex-wrap justify-center gap-2">
                  {['Isolated execution', 'Runtime configuration', 'Function logs'].map(
                    (feature) => (
                      <Badge variant="outline" key={feature}>
                        {feature}
                      </Badge>
                    ),
                  )}
                </div>
                <ShadcnButton variant="outline" asChild>
                  <a href={docsURL + '/docs/roadmap/phases'}>
                    Explore the roadmap
                    <ArrowUpRight data-icon="inline-end" />
                  </a>
                </ShadcnButton>
              </EmptyContent>
            </ShadcnEmpty>
          </CardContent>
        </Card>
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/functions')({ component: FunctionsRoute });
