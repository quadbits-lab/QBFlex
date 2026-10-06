import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeShiki from '@shikijs/rehype';
export default defineConfig({
  plugins: [
    mdx({
      remarkPlugins: [remarkGfm],
      rehypePlugins: [
        rehypeSlug,
        [
          rehypeShiki,
          { themes: { dark: 'github-dark-default', light: 'github-light' }, defaultColor: 'dark' },
        ],
      ],
    }),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true, failOnError: true, concurrency: 4 },
    }),
    tailwind(),
    react(),
  ],
  server: { port: 7611, strictPort: true },
  resolve: {
    alias: {
      '@qb-flex/ui/src/theme.css': new URL('../../packages/ui/src/theme.css', import.meta.url)
        .pathname,
    },
    dedupe: ['react', 'react-dom'],
  },
});
