import {
  redactLogEvent,
  terminalSettings,
  quietInternalLog,
  formatPrettyLog,
  type LogEvent,
} from './terminal';
export {
  printStartup,
  formatStartupPanel,
  formatPrettyLog,
  terminalSettings,
  redactLogEvent,
  quietInternalLog,
} from './terminal';
import { routes } from '@qb-flex/contracts';

const patterns = routes
  .filter(([method]) => method !== 'WS')
  .map(([method, path]) => ({
    method,
    template: path.replace(/\{([^}]+)\}/g, ':$1'),
    pattern: new RegExp(
      '^' +
        path
          .split('/')
          .map((part) =>
            /^\{[^}]+\}$/.test(part)
              ? '[^/]+'
              : part === '*'
                ? '.*'
                : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          )
          .join('/') +
        '$',
    ),
  }));
/** Labels come from route contracts, never raw user IDs, row keys, tokens or query strings. */
function metricRoute(method: string, path: string) {
  const pathname = path.split('?')[0]!;
  const match = patterns.find(
    (route) => route.method.split('/').includes(method) && route.pattern.test(pathname),
  );
  return match?.template ?? '/:other';
}

/** Logs use an explicit allowlist: request bodies, cookies and credentials never enter it. */
export function log(event: LogEvent) {
  const record = redactLogEvent(event);
  const settings = terminalSettings();
  if (settings.format === 'pretty') {
    if (!settings.internal && quietInternalLog(record)) return;
    console.log(
      formatPrettyLog(record, { color: settings.color, width: process.stdout.columns || 120 }),
    );
  } else console.log(JSON.stringify(record));
}
export class Metrics {
  private bounds = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
  private values = new Map<
    string,
    { count: number; errors: number; total: number; max: number; buckets: number[] }
  >();
  record(method: string, path: string, status: number, ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    const verb = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)
      ? method
      : 'OTHER';
    const key = `${verb} ${metricRoute(verb, path)}`;
    if (!this.values.has(key) && this.values.size >= 128) return;
    const value = this.values.get(key) ?? {
      count: 0,
      errors: 0,
      total: 0,
      max: 0,
      buckets: this.bounds.map(() => 0),
    };
    value.count++;
    value.errors += Number(status >= 400);
    value.total += ms;
    value.max = Math.max(value.max, ms);
    this.bounds.forEach((bound, index) => {
      if (ms <= bound) value.buckets[index]!++;
    });
    this.values.set(key, value);
  }
  snapshot() {
    return new Map(this.values);
  }
  render(gauges: Record<string, number>) {
    const lines = [
      '# TYPE qb_http_requests_total counter',
      '# TYPE qb_http_errors_total counter',
      '# TYPE qb_http_duration_seconds_sum counter',
      '# TYPE qb_http_request_duration_seconds histogram',
    ];
    for (const [route, value] of this.values) {
      const labels = `{route=${JSON.stringify(route)}}`;
      lines.push(
        `qb_http_requests_total${labels} ${value.count}`,
        `qb_http_errors_total${labels} ${value.errors}`,
        `qb_http_duration_seconds_sum${labels} ${value.total / 1000}`,
        `qb_http_duration_seconds_max${labels} ${value.max / 1000}`,
        ...this.bounds.map(
          (bound, index) =>
            `qb_http_request_duration_seconds_bucket{route=${JSON.stringify(route)},le="${bound / 1000}"} ${value.buckets[index]}`,
        ),
        `qb_http_request_duration_seconds_bucket{route=${JSON.stringify(route)},le="+Inf"} ${value.count}`,
        `qb_http_request_duration_seconds_count${labels} ${value.count}`,
        `qb_http_request_duration_seconds_sum${labels} ${value.total / 1000}`,
      );
    }
    for (const [name, value] of Object.entries(gauges)) {
      if (/^[a-z][a-z0-9_]{0,63}$/.test(name) && Number.isFinite(value))
        lines.push(`qb_${name} ${value}`);
    }
    return lines.join('\n') + '\n';
  }
}
