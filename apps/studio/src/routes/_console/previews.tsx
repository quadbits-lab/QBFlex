import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { PreviewsWorkspace } from '../../workspaces/previews';

function PreviewsRoute() {
  const { project, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Previews"
        hint="Disposable schema forks with a TTL. Production rows are not copied."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}.</NoticeBox>
      ) : (
        <PreviewsWorkspace key={project.id} projectId={project.id} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/previews')({ component: PreviewsRoute });
