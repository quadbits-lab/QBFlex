import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { AuthWorkspace } from '../../workspaces/auth';

function Component() {
  const { project, base, branch, state } = useConsole();
  return (
    <div className="grid grid-cols-1 gap-5">
      <WorkspaceHeader
        view="Authentication"
        hint="Users, application roles, providers and verification settings."
        project={project}
        branchName={state.branch === 'primary' ? 'main' : (branch?.name ?? 'main')}
      />
      {project ? (
        project.status === 'ready' ? (
          <AuthWorkspace key={base} base={base} project={project} />
        ) : (
          <NoticeBox>Project is {project.status}. Provisioning runs in the background.</NoticeBox>
        )
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/auth')({ component: Component });
