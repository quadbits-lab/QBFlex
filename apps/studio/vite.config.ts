import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tanstackStart(), tailwind(), react()],
  server: { port: 7610, strictPort: true },
  // @visx ships extensionless ESM imports that Node's native resolver rejects.
  // Bundle them for SSR so chart routes can still render.
  // Keep sonner in the app graph so Toaster and toast() share one module instance.
  ssr: {
    noExternal: [/^@visx\//, 'sonner'],
  },
  resolve: {
    alias: {
      '@qb-flex/ui/src/theme.css': new URL('../../packages/ui/src/theme.css', import.meta.url)
        .pathname,
      sonner: new URL('../../node_modules/sonner/dist/index.mjs', import.meta.url).pathname,
    },
    dedupe: ['react', 'react-dom', 'sonner'],
  },
  optimizeDeps: {
    include: ['sonner'],
  },
});
