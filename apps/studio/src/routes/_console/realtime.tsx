import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { RealtimeWorkspace } from '../../workspaces/realtime';

function RealtimeRoute() {
  const { project, state, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Realtime"
        hint="Trace connection metadata for an application identity on this branch."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}.</NoticeBox>
      ) : (
        <RealtimeWorkspace key={state.branch} projectId={project.id} branchId={state.branch} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/realtime')({ component: RealtimeRoute });
