import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { ReviewsWorkspace } from '../../workspaces/reviews';

function ReviewsRoute() {
  const { project, state, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Schema Reviews"
        hint="Draft, rehearse and approve SQL before it reaches the live branch."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}.</NoticeBox>
      ) : (
        <ReviewsWorkspace key={state.branch} projectId={project.id} branchId={state.branch} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/reviews')({ component: ReviewsRoute });
