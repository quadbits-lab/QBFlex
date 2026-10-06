import { log } from '@qb-flex/observability';
import { readWorkerToken } from './token';
const api = process.env.QB_INTERNAL_API_URL ?? 'http://localhost:7612';
let token: string;
try {
  token = readWorkerToken();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Worker credential configuration failed.');
  process.exit(1);
}
let stopped = false;
let busy = false;
async function tick() {
  if (stopped || busy) return;
  busy = true;
  try {
    const response = await fetch(api + '/internal/maintenance', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok) throw new Error('Worker operation failed');
    log({ action: 'maintenance.completed' });
  } catch {
    log({ action: 'maintenance.failed' });
  } finally {
    busy = false;
  }
}
const timer = setInterval(() => void tick(), 60000);
void tick();
const stop = () => {
  stopped = true;
  clearInterval(timer);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
