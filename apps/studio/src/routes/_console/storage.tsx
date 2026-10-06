import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { StorageWorkspace } from '../../workspaces/storage';

function Component() {
  const { project, base, branch, state } = useConsole();
  return (
    <div className="grid grid-cols-1 gap-5">
      <WorkspaceHeader
        view="Storage"
        hint="Object buckets and application uploads for the selected branch."
        project={project}
        branchName={state.branch === 'primary' ? 'main' : (branch?.name ?? 'main')}
      />
      {project ? (
        project.status === 'ready' ? (
          <StorageWorkspace key={base} base={base} />
        ) : (
          <NoticeBox>Project is {project.status}. Provisioning runs in the background.</NoticeBox>
        )
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/storage')({ component: Component });
