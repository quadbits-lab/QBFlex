import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { SchemaVisualizer } from '../../workspaces/schema';

function Component() {
  const { project, base, branch, state } = useConsole();
  return (
    <div className="grid grid-cols-1 gap-5">
      <WorkspaceHeader
        view="Schema Visualizer"
        hint="A workflow canvas of the branch schema — tables, columns and foreign keys."
        project={project}
        branchName={state.branch === 'primary' ? 'main' : (branch?.name ?? 'main')}
      />
      {project ? (
        project.status === 'ready' ? (
          <SchemaVisualizer key={base} base={base} />
        ) : (
          <NoticeBox>Project is {project.status}. Provisioning runs in the background.</NoticeBox>
        )
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/schema')({ component: Component });
