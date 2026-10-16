import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { JobInbox } from '../../workspaces/jobs';

function JobsRoute() {
  const { project, base, branch } = useConsole();
  return (
    <div className="grid min-w-0 gap-5">
      <WorkspaceHeader
        view="Job Inbox"
        hint="Private durable-work metadata, fenced attempts and explicit dead-letter replay."
        project={project}
        branchName={branch?.name ?? 'main'}
      />
      {!project ? (
        <NoProject />
      ) : project.status !== 'ready' ? (
        <NoticeBox>Project is {project.status}. Jobs are available after provisioning.</NoticeBox>
      ) : (
        <JobInbox key={base} base={base} />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/jobs')({ component: JobsRoute });
