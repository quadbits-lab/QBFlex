import type { ReactNode } from 'react';
import { Notice, Empty, Button } from '@qb-flex/ui';
import { Plus } from 'lucide-react';
export function WorkspaceHeader({
  view,
  hint,
  project,
  branchName,
  action,
}: {
  view: string;
  hint: string;
  project?: any;
  branchName?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <p className="mb-2 truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {project?.name ?? 'Workspace'} · {branchName ?? 'main'}
        </p>
        <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">{view}</h1>
        <p className="m-0 max-w-2xl text-sm leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}
export function NewProjectAction({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button onClick={onClick} disabled={disabled}>
      <Plus size={16} aria-hidden="true" /> New project
    </Button>
  );
}
export function NoProject() {
  return (
    <Empty title="Create your first project">
      A project brings together an isolated database, authentication and APIs. Use “New project” in
      the command palette or top bar to start.
    </Empty>
  );
}
export function NoticeBox({ children }: { children: ReactNode }) {
  return <Notice>{children}</Notice>;
}
