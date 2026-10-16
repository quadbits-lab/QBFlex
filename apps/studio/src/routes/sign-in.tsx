import { createFileRoute } from '@tanstack/react-router';
import { SignInScreen, AuthRouteError } from '../auth-screen';
import { guardStudioRoute, studioReturnTo } from '../session';
export const Route = createFileRoute('/sign-in')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: studioReturnTo(search.redirect),
  }),
  beforeLoad: ({ context, search }) =>
    guardStudioRoute(context.queryClient, 'sign-in', search.redirect),
  errorComponent: AuthRouteError,
  component: SignInScreen,
});
