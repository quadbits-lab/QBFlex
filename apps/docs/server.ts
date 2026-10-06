import { join, resolve } from 'node:path';
const root = resolve(import.meta.dir, 'dist/client');
const entry = await import('./dist/server/server.js');
Bun.serve({
  port: Number(process.env.PORT ?? 7611),
  hostname: process.env.HOST ?? '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path.startsWith(root + '/')) {
      for (const candidate of [path, join(path, 'index.html')]) {
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
    }
    return entry.default.fetch(request);
  },
});
