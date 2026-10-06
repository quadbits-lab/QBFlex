import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoticeBox } from '../../workspace-header';
import { SettingsWorkspace } from '../../workspaces/settings';

function Component() {
  const { project, branch, state } = useConsole();
  return (
    <div className="grid grid-cols-1 gap-6">
      <WorkspaceHeader
        view="Account & User Management"
        hint="Manage your profile, security, workspace access, and automation credentials."
        project={project}
        branchName={state.branch === 'primary' ? 'main' : (branch?.name ?? 'main')}
      />
      {project && project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}. Provisioning runs in the background.</NoticeBox>
      ) : null}
      <SettingsWorkspace
        project={project?.status === 'ready' ? project : null}
        organizationId={state.organization}
      />
    </div>
  );
}
export const Route = createFileRoute('/_console/settings')({ component: Component });
