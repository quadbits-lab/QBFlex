import { createFileRoute } from '@tanstack/react-router';
import { SetupScreen, AuthRouteError } from '../auth-screen';
import { guardStudioRoute } from '../session';
export const Route = createFileRoute('/setup')({
  ssr: false,
  beforeLoad: ({ context }) => guardStudioRoute(context.queryClient, 'setup'),
  errorComponent: AuthRouteError,
  component: SetupScreen,
});
