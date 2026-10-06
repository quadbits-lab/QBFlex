import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tanstackStart(), tailwind(), react()],
  server: { port: 7610, strictPort: true },
  resolve: {
    alias: {
      '@qb-flex/ui/src/theme.css': new URL('../../packages/ui/src/theme.css', import.meta.url)
        .pathname,
    },
    dedupe: ['react', 'react-dom'],
  },
});
