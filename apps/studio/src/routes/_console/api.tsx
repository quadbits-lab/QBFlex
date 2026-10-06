import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useConsole } from '../../console-context';
import { WorkspaceHeader, NoProject, NoticeBox } from '../../workspace-header';
import { APIWorkspace } from '../../workspaces/api';
function ApiRoute() {
  const { project, base, branch, state } = useConsole();
  const [keyValue, setKeyValue] = useState('');
  useEffect(() => setKeyValue(''), [project?.id]);
  return (
    <div className="grid grid-cols-1 gap-5">
      <WorkspaceHeader
        view="API"
        hint="Connect applications through REST with publishable keys."
        project={project}
        branchName={state.branch === 'primary' ? 'main' : (branch?.name ?? 'main')}
      />
      {project ? (
        project.status === 'ready' ? (
          <APIWorkspace
            key={base}
            base={base}
            project={project}
            keyValue={keyValue}
            setKeyValue={setKeyValue}
          />
        ) : (
          <NoticeBox>Project is {project.status}. Provisioning runs in the background.</NoticeBox>
        )
      ) : (
        <NoProject />
      )}
    </div>
  );
}
export const Route = createFileRoute('/_console/api')({ component: ApiRoute });
