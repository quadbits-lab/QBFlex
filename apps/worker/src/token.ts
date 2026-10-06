import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Read the API-owned credential; workers must never mint their own token. */
export function readWorkerToken(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.QB_WORKER_TOKEN) return environment.QB_WORKER_TOKEN;
  if (environment.NODE_ENV === 'production')
    throw new Error(
      'Set QB_WORKER_TOKEN to the same server-only credential configured for the API.',
    );
  let token: string;
  try {
    token = readFileSync(
      resolve(environment.QB_DATA_DIR ?? '.data', 'worker.token'),
      'utf8',
    ).trim();
  } catch {
    throw new Error(
      'Worker token is unavailable. Start the API first with the same QB_DATA_DIR, or configure matching QB_WORKER_TOKEN values for the API and worker. Do not create worker.token manually.',
    );
  }
  if (!token)
    throw new Error('worker.token is empty. Check the API-owned credential configuration.');
  return token;
}
