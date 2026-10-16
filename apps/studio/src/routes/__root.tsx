import { createRootRouteWithContext, HeadContent, Scripts, Outlet } from '@tanstack/react-router';
import { Toaster } from '@qb-flex/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import '@qb-flex/ui/src/theme.css';
import '../styles.css';
import { UploadQueueProvider } from '../upload-queue-provider';
import { RouteErrorPage, RouteNotFoundPage } from '../error-pages';
import { RoutePreloader, RouteProgressBar } from '../route-preloader';

function Root() {
  const { queryClient: client } = Route.useRouteContext();
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to workspace
        </a>
        <QueryClientProvider client={client}>
          <UploadQueueProvider>
            <RouteProgressBar />
            <Outlet />
            <Toaster
              position="bottom-left"
              richColors
              closeButton
              duration={4500}
              visibleToasts={5}
            />
          </UploadQueueProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'QB Flex Studio' },
    ],
    links: [{ rel: 'icon', href: '/brand/icon.webp' }],
  }),
  component: Root,
  pendingComponent: RoutePreloader,
  errorComponent: RouteErrorPage,
  notFoundComponent: RouteNotFoundPage,
});
