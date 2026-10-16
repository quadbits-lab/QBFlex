import { notifyError } from '@qb-flex/ui';
import { createStudioQueryClient } from './query-client';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { RouteErrorPage, RouteNotFoundPage } from './error-pages';
import { RoutePreloader } from './route-preloader';

export function getRouter() {
  return createRouter({
    routeTree,
    context: { queryClient: createStudioQueryClient((error) => notifyError(error)) },
    scrollRestoration: true,
    defaultPendingComponent: RoutePreloader,
    defaultPendingMs: 120,
    defaultPendingMinMs: 240,
    defaultErrorComponent: RouteErrorPage,
    defaultNotFoundComponent: RouteNotFoundPage,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
