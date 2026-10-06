import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoticeBox } from '../../workspace-header';
import { AuditLog } from '../../workspaces/audit';
function LogsRoute() {
  const { project } = useConsole();
  return (
    <div className="grid grid-cols-1 gap-5">
      <WorkspaceHeader
        view="Activity"
        hint="Charts, breakdowns, and searchable audit events for the selected project."
        project={project}
      />
      {project?.id ? (
        <AuditLog projectId={project.id} />
      ) : (
        <NoticeBox>Select a project to view its audit events.</NoticeBox>
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/logs')({ component: LogsRoute });
