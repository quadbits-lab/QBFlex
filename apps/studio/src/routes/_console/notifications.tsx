import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject } from '../../workspace-header';
import { NotificationCenter } from '../../workspaces/notifications';

function NotificationsRoute() {
  const { state, project } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Notifications"
        hint="Operational alert history and notification-center settings."
        project={project}
        branchName="organization"
      />
      {!state.organization ? (
        <NoProject />
      ) : (
        <NotificationCenter key={state.organization} organizationId={state.organization} />
      )}
    </div>
  );
}

export const Route = createFileRoute('/_console/notifications')({ component: NotificationsRoute });
