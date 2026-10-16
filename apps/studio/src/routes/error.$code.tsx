import { createFileRoute, notFound } from '@tanstack/react-router';
import { HttpErrorPage, type HttpErrorCode } from '../error-pages';

const ALLOWED = new Set(['400', '404', '500']);

export const Route = createFileRoute('/error/$code')({
  beforeLoad: ({ params }) => {
    if (!ALLOWED.has(params.code)) throw notFound();
  },
  component: ErrorPreview,
  head: ({ params }) => ({
    meta: [{ title: `HTTP ${params.code} · QB Flex Studio` }],
  }),
});

function ErrorPreview() {
  const { code } = Route.useParams();
  return (
    <HttpErrorPage
      code={Number(code) as HttpErrorCode}
      message={
        code === '400'
          ? 'Example validation failure: missing or invalid request payload.'
          : code === '404'
            ? 'Example missing route: /this-path-does-not-exist'
            : 'Example upstream failure: owner process returned an unexpected error.'
      }
    />
  );
}
