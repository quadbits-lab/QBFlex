import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { AssistantWorkspace } from '../../workspaces/assistant';

function AiRoute() {
  const { project, state, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Assistant"
        hint="Propose migrations, policies and hooks. Writes stay in schema reviews."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}.</NoticeBox>
      ) : (
        <AssistantWorkspace key={state.branch} projectId={project.id} branchId={state.branch} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/ai')({ component: AiRoute });
