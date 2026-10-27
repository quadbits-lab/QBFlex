import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { InspectorWorkspace } from '../../workspaces/inspector';

function InspectorRoute() {
  const { project, state, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Query Inspector"
        hint="Review slow SELECT fingerprints and owner-side EXPLAIN plans."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}.</NoticeBox>
      ) : (
        <InspectorWorkspace key={state.branch} projectId={project.id} branchId={state.branch} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/inspector')({ component: InspectorRoute });
