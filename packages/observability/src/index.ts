/** Logs use an explicit allowlist: request bodies, cookies and credentials never enter it. */
export function log(event: {
  requestId?: string;
  traceId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  action?: string;
  code?: string;
}) {
  const fields = [
    'requestId',
    'traceId',
    'method',
    'path',
    'status',
    'durationMs',
    'action',
    'code',
  ] as const;
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      ...Object.fromEntries(
        fields
          .filter((key) => event[key] !== undefined)
          .map((key) => [
            key,
            key === 'path' && typeof event.path === 'string'
              ? event.path.replace(/(\/auth\/reset-password\/)[^/]+/, '$1:token')
              : event[key],
          ]),
      ),
    }),
  );
}
export class Metrics {
  private values = new Map<string, { count: number; errors: number; total: number; max: number }>();
  record(method: string, path: string, status: number, ms: number) {
    const route = path.replace(/[a-f0-9-]{36}/g, ':id').replace(/\/auth\/.*/, '/auth/:action');
    const key = `${method} ${route}`;
    if (!this.values.has(key) && this.values.size >= 128) return;
    const value = this.values.get(key) ?? { count: 0, errors: 0, total: 0, max: 0 };
    value.count++;
    value.errors += Number(status >= 400);
    value.total += ms;
    value.max = Math.max(value.max, ms);
    this.values.set(key, value);
  }
  render(gauges: Record<string, number>) {
    const lines = [
      '# TYPE qb_http_requests_total counter',
      '# TYPE qb_http_errors_total counter',
      '# TYPE qb_http_duration_seconds_sum counter',
    ];
    for (const [route, value] of this.values) {
      const labels = `{route=${JSON.stringify(route)}}`;
      lines.push(
        `qb_http_requests_total${labels} ${value.count}`,
        `qb_http_errors_total${labels} ${value.errors}`,
        `qb_http_duration_seconds_sum${labels} ${value.total / 1000}`,
        `qb_http_duration_seconds_max${labels} ${value.max / 1000}`,
      );
    }
    for (const [name, value] of Object.entries(gauges)) lines.push(`qb_${name} ${value}`);
    return lines.join('\n') + '\n';
  }
}
