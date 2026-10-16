import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceDetails } from '../../workspaces/workspace-details';
import { WorkspaceHeader } from '../../workspace-header';

function Component() {
  const { project, state } = useConsole();
  if (!state.organization) {
    return <WorkspaceDetails />;
  }
  return (
    <div className="grid grid-cols-1 gap-5">
      <WorkspaceHeader
        view="Workspace"
        hint="Profile, projects and workspace lifecycle."
        project={project}
      />
      <WorkspaceDetails />
    </div>
  );
}
export const Route = createFileRoute('/_console/workspace')({ component: Component });
