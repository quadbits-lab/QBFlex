import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const directory = resolve(import.meta.dir, '../apps/docs/dist');
const entry = await import(resolve(directory, 'server/server.js'));
const response = await entry.default.fetch(
  new Request((process.env.QB_DOCS_URL ?? 'http://localhost:7611') + '/__qb_missing_documentation'),
);
if (response.status !== 404) throw new Error('Documentation 404 prerender did not return 404');
writeFileSync(resolve(directory, 'client/404.html'), await response.text());
console.log('Static documentation 404 fallback generated.');
