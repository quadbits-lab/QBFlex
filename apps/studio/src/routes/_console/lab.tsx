import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { LabWorkspace } from '../../workspaces/lab';

function LabRoute() {
  const { project, state, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Data Lab"
        hint="Parse a local CSV or JSON file in the browser. Filters never leave this tab."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}.</NoticeBox>
      ) : (
        <LabWorkspace key={state.branch} projectId={project.id} branchId={state.branch} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/lab')({ component: LabRoute });
