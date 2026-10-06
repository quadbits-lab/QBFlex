import { createRootRoute, HeadContent, Scripts, Outlet } from '@tanstack/react-router';
import '@qb-flex/ui/src/theme.css';
import '../styles.css';
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'QB Flex Docs' },
      {
        name: 'description',
        content: 'Documentation and practical React and JavaScript tutorials for QB Flex.',
      },
    ],
    links: [{ rel: 'icon', href: '/brand/icon.webp' }],
  }),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
  notFoundComponent: () => (
    <main id="main" className="not-found">
      <p className="eyebrow">404 / DOCUMENTATION</p>
      <h1>That page isn’t here.</h1>
      <p>The article may have moved. Start from the documentation index.</p>
      <a className="button button-primary" href="/">
        Open documentation
      </a>
    </main>
  ),
});
