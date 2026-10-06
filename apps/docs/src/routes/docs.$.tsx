import { createFileRoute, notFound } from '@tanstack/react-router';
import { DocsPage } from '../components';
import { documentBySlug } from '../library';
export const Route = createFileRoute('/docs/$')({
  loader: ({ params }) => {
    const doc = documentBySlug(params._splat ?? '');
    if (!doc) throw notFound();
    return { title: doc.meta.title, description: doc.meta.description, slug: doc.meta.slug };
  },
  head: ({ loaderData }) => {
    const origin = import.meta.env.VITE_DOCS_URL ?? 'http://localhost:7611';
    return {
      meta: [
        { title: `${loaderData?.title ?? 'Documentation'} · QB Flex` },
        { name: 'description', content: loaderData?.description },
        { property: 'og:title', content: loaderData?.title },
        { property: 'og:description', content: loaderData?.description },
        { property: 'og:type', content: 'article' },
        { property: 'og:image', content: `${origin}/brand/icon.webp` },
        { property: 'og:url', content: `${origin}/docs/${loaderData?.slug}` },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: loaderData?.title },
      ],
      links: [{ rel: 'canonical', href: `${origin}/docs/${loaderData?.slug}` }],
    };
  },
  component: () => {
    const params = Route.useParams();
    return <DocsPage slug={params._splat ?? ''} />;
  },
});
