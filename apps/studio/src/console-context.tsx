import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Store, useStore } from '@tanstack/react-store';
import { useQuery } from '@tanstack/react-query';
import { management } from './api';

export interface ConsoleState {
  organization: string;
  project: string;
  branch: string;
}

interface ConsoleContextValue {
  state: ConsoleState;
  select: (values: Partial<ConsoleState>) => void;
  organizations: ReturnType<typeof useOrganizationQuery>;
  projects: ReturnType<typeof useProjectQuery>;
  branches: ReturnType<typeof useBranchQuery>;
  relevant: any[];
  project: any;
  branch: any;
  base: string;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

function useOrganizationQuery() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => management.request<any[]>('/organizations'),
  });
}
function useProjectQuery() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => management.request<any[]>('/projects'),
    refetchInterval: (q) =>
      q.state.data?.data.some((p: any) => p.status === 'provisioning') ? 1000 : false,
  });
}
function useBranchQuery(projectId: string | undefined, ready: boolean) {
  return useQuery({
    queryKey: ['branches', projectId],
    enabled: !!projectId && ready,
    queryFn: () => management.request<any[]>(`/projects/${projectId}/branches`),
  });
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [store] = useState(
    () => new Store<ConsoleState>({ organization: '', project: '', branch: 'primary' }),
  );
  const state = useStore(store);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('qb-console-context') ?? 'null');
      if (
        saved &&
        typeof saved.organization === 'string' &&
        typeof saved.project === 'string' &&
        typeof saved.branch === 'string'
      )
        store.setState(() => saved);
    } catch {
      /* Ignore unavailable storage or an outdated selection. */
    }
    setRestored(true);
  }, [store]);
  useEffect(() => {
    if (restored) sessionStorage.setItem('qb-console-context', JSON.stringify(state));
  }, [restored, state]);
  const select = (values: Partial<ConsoleState>) => store.setState((s) => ({ ...s, ...values }));
  const organizations = useOrganizationQuery();
  const projects = useProjectQuery();
  const relevant = projects.data?.data.filter((p: any) => p.org_id === state.organization) ?? [];
  const project = relevant.find((p: any) => p.id === state.project);
  const branches = useBranchQuery(state.project, project?.status === 'ready');
  const branch = branches.data?.data.find(
    (b: any) => b.id === state.branch || (state.branch === 'primary' && b.name === 'main'),
  );
  useEffect(() => {
    if (!restored || !organizations.data) return;
    // Empty selection is intentional onboarding — do not auto-pick a workspace.
    // Only clear a persisted id that no longer exists for this account.
    if (
      state.organization &&
      !organizations.data.data.some((o: any) => o.id === state.organization)
    )
      select({ organization: '', project: '', branch: 'primary' });
  }, [organizations.data, restored, state.organization]);
  useEffect(() => {
    if (!restored || !state.organization) return;
    if (!project && relevant[0]) select({ project: relevant[0].id, branch: 'primary' });
  }, [projects.data, state.organization, state.project, restored]);
  useEffect(() => {
    if (
      branches.data &&
      state.branch !== 'primary' &&
      !branches.data.data.some((b: any) => b.id === state.branch && b.status === 'ready')
    )
      select({ branch: 'primary' });
  }, [branches.data, state.branch]);
  const base = `/projects/${state.project}/branches/${state.branch}`;
  return (
    <ConsoleContext.Provider
      value={{ state, select, organizations, projects, branches, relevant, project, branch, base }}
    >
      {children}
    </ConsoleContext.Provider>
  );
}

export function useConsole() {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error('useConsole must be used inside ConsoleProvider');
  return value;
}
