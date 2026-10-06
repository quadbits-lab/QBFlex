import { createRootRoute, HeadContent, Scripts, Outlet } from '@tanstack/react-router';
import { Toaster, notifyError } from '@qb-flex/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import '@qb-flex/ui/src/theme.css';
import '../styles.css';

function Root() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 5000 },
          mutations: {
            onError: (error) => {
              notifyError(error);
            },
          },
        },
      }),
  );
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
          <Outlet />
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            duration={4500}
            visibleToasts={5}
          />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'QB Flex Studio' },
    ],
    links: [{ rel: 'icon', href: '/brand/icon.webp' }],
  }),
  component: Root,
  notFoundComponent: () => (
    <main id="main" className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 px-6">
      <h1>Workspace not found</h1>
      <a href="/">Open Studio</a>
    </main>
  ),
});
