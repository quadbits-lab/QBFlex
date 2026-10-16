import { createFileRoute, Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ConsoleProvider, useConsole } from '../console-context';
import { ConsoleShell } from '../console-shell';
import { AuthUnavailableScreen, AuthRouteError } from '../auth-screen';
import { WorkspaceDetails } from '../workspaces/workspace-details';
import { RoutePreloader } from '../route-preloader';
import { guardStudioRoute, platformSessionOptions, studioReturnTo } from '../session';

export const Route = createFileRoute('/_console')({
  ssr: false,
  beforeLoad: ({ context, location }) =>
    guardStudioRoute(context.queryClient, 'console', location.href),
  errorComponent: AuthRouteError,
  component: ConsoleLayout,
});

function ConsoleLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = studioReturnTo(location.href);
  const session = useQuery({
    ...platformSessionOptions(),
    refetchOnMount: false,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (session.isSuccess && !session.data)
      void navigate({ to: '/sign-in', search: { redirect: returnTo }, replace: true });
  }, [session.isSuccess, session.data, navigate, returnTo]);
  if (session.isPending) return <RoutePreloader />;
  if (session.error)
    return (
      <AuthUnavailableScreen
        error={session.error}
        onRetry={() => {
          void session.refetch();
        }}
      />
    );
  if (!session.data) return <RoutePreloader />;
  return (
    <ConsoleProvider>
      <ConsoleFrame user={session.data.user} />
    </ConsoleProvider>
  );
}

function ConsoleFrame({ user }: { user: { name: string; email: string; image?: string | null } }) {
  const { state } = useConsole();
  if (!state.organization) return <WorkspaceDetails />;
  return (
    <ConsoleShell user={user}>
      <Outlet />
    </ConsoleShell>
  );
}
