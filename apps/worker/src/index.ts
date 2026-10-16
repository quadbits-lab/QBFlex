import { log } from '@qb-flex/observability';
import { readWorkerToken } from './token';
import { JobExecutor } from './job-executor';
import { parseInternalAllowlist } from './webhook-delivery';
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
const controller = new AbortController();
const executor = new JobExecutor(api, token, {
  allowlist: parseInternalAllowlist(process.env.QB_WEBHOOK_INTERNAL_ALLOWLIST),
});
const jobTimer = setInterval(() => {
  if (!stopped)
    void executor.tick(controller.signal).catch(() => log({ action: 'jobs.executor.failed' }));
}, 2000);
async function tick() {
  if (stopped || busy) return;
  busy = true;
  try {
    const response = await fetch(api + '/internal/maintenance', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]),
    });
    if (!response.ok) throw new Error('Worker operation failed');
    log({ action: 'maintenance.completed' });
  } catch {
    log({ action: 'maintenance.failed' });
  } finally {
    busy = false;
  }
}
log({ action: 'worker.started' });
const timer = setInterval(() => void tick(), 60000);
void tick();
const stop = () => {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  clearInterval(jobTimer);
  controller.abort();
  log({ action: 'worker.stopped' });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
