import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { WebhookWorkspace } from '../../workspaces/webhooks';
function WebhooksRoute() {
  const { project, base, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Webhooks"
        hint="Signed, policy-aware deliveries from committed database events."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}.</NoticeBox>
      ) : (
        <WebhookWorkspace key={base} base={base} projectId={project.id} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/webhooks')({ component: WebhooksRoute });
