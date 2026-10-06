import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { DatabaseWorkspace } from '../../workspaces/database';

function DatabaseRoute() {
  const { project, base, branch, state } = useConsole();
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <WorkspaceHeader
        view="Database"
        hint="Table editor for rows, schema exposure, policies and migrations."
        project={project}
        branchName={state.branch === 'primary' ? 'main' : (branch?.name ?? 'main')}
      />
      {project ? (
        project.status === 'ready' ? (
          <DatabaseWorkspace key={base} base={base} />
        ) : (
          <NoticeBox>Project is {project.status}. Provisioning runs in the background.</NoticeBox>
        )
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/database')({ component: DatabaseRoute });
