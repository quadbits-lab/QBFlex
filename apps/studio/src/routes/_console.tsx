import { createFileRoute, Outlet, Navigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Loading } from '@qb-flex/ui';
import { raw } from '../api';
import { ConsoleProvider } from '../console-context';
import { ConsoleShell } from '../console-shell';
import { AuthUnavailableScreen } from '../auth-screen';

export const Route = createFileRoute('/_console')({
  component: ConsoleLayout,
});

function ConsoleLayout() {
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => raw('/setup') });
  const session = useQuery({
    queryKey: ['platform-session'],
    queryFn: () => raw('/platform/auth/get-session'),
  });
  if (setup.isPending || session.isPending)
    return (
      <div className="grid grid-cols-1 min-h-screen place-items-center">
        <Loading />
      </div>
    );
  if (setup.error || session.error)
    return (
      <AuthUnavailableScreen
        error={(setup.error ?? session.error) as Error}
        onRetry={() => {
          void setup.refetch();
          void session.refetch();
        }}
      />
    );
  if (setup.data?.data?.required) return <Navigate to="/setup" replace />;
  if (!session.data?.user) return <Navigate to="/sign-in" replace />;
  return (
    <ConsoleProvider>
      <ConsoleShell user={session.data.user}>
        <Outlet />
      </ConsoleShell>
    </ConsoleProvider>
  );
}
