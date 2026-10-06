import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { Overview } from '../../workspaces/overview';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';

function OverviewRoute() {
  const { project, base, state } = useConsole();
  return (
    <div className="grid grid-cols-1 gap-5">
      <WorkspaceHeader
        view="Overview"
        hint="Your application, from database to delivery."
        project={project}
        branchName={state.branch === 'primary' ? 'main' : undefined}
      />
      {project ? (
        project.status === 'ready' ? (
          <Overview project={project} base={base} />
        ) : (
          <NoticeBox>Project is {project.status}. Provisioning runs in the background.</NoticeBox>
        )
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/overview')({ component: OverviewRoute });
