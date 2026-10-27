export type LogEvent = {
  requestId?: string;
  traceId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  action?: string;
  code?: string;
};
export type LogRecord = LogEvent & { time: string };
type Environment = Record<string, string | undefined>;

export function terminalSettings(
  environment: Environment = process.env,
  tty = !!process.stdout.isTTY,
) {
  const requested = environment.QB_LOG_FORMAT;
  const format =
    requested === 'pretty' || requested === 'json'
      ? requested
      : tty && environment.NODE_ENV !== 'production'
        ? 'pretty'
        : 'json';
  const color =
    environment.NO_COLOR === undefined &&
    environment.TERM !== 'dumb' &&
    environment.FORCE_COLOR !== '0' &&
    (tty || (!!environment.FORCE_COLOR && environment.FORCE_COLOR !== '0'));
  return { format, color, internal: environment.QB_LOG_INTERNAL === 'true' };
}

/** Strip terminal controls before styling; callers may supply request IDs and paths. */
const clean = (value: string) =>
  value
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
const fit = (value: string, width: number) =>
  value.length <= width ? value : value.slice(0, Math.max(0, width - 1)) + '…';
const paint = (value: string, code: number, color: boolean) =>
  color ? `\x1b[${code}m${value}\x1b[0m` : value;

/** The same allowlist and redaction apply to pretty and JSON output. */
export function redactLogEvent(event: LogEvent, time = new Date().toISOString()): LogRecord {
  const record: LogRecord = { time };
  for (const field of ['requestId', 'traceId', 'method', 'path', 'action', 'code'] as const) {
    if (typeof event[field] !== 'string') continue;
    const value =
      field === 'path'
        ? event[field]!.split(/[?#]/)[0]!.replace(/(\/auth\/reset-password\/)[^/]+/, '$1:token')
        : event[field]!;
    record[field] = clean(value).slice(0, field === 'path' ? 512 : 128);
  }
  for (const field of ['status', 'durationMs'] as const) {
    const value = event[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) record[field] = value;
  }
  return record;
}

export function quietInternalLog(record: LogRecord) {
  return (
    record.status !== undefined &&
    record.status < 400 &&
    (record.durationMs ?? 0) < 1000 &&
    ['/internal/jobs/targets', '/internal/jobs/claim', '/internal/metrics'].includes(
      record.path ?? '',
    )
  );
}

export function formatPrettyLog(
  record: LogRecord,
  options: { color?: boolean; width?: number } = {},
) {
  const color = options.color ?? false;
  const width = Math.max(40, Math.min(200, options.width ?? 120));
  const time = new Date(record.time);
  const clock = Number.isFinite(time.getTime())
    ? `${time.toTimeString().slice(0, 8)}.${String(time.getMilliseconds()).padStart(3, '0')}`
    : '--:--:--.---';
  const prefix = paint(clock, 90, color) + paint(' │ ', 90, color);
  if (record.method) {
    const status = record.status ?? 0;
    const tone = status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : 32;
    const duration =
      record.durationMs === undefined
        ? ''
        : `${record.durationMs < 10 ? record.durationMs.toFixed(2) : record.durationMs.toFixed(1)} ms`;
    const requestId = record.requestId ? `#${record.requestId.slice(0, 8)}` : '';
    const code = record.code ? ` ${record.code}` : '';
    const suffix = [duration, requestId].filter(Boolean).join('  ');
    const path = fit(record.path ?? '/', Math.max(8, width - 37 - suffix.length - code.length));
    return `${prefix}${paint(String(status).padEnd(3), tone, color)} ${paint(record.method.padEnd(7), 1, color)} ${path}${paint(code, tone, color)}  ${paint(suffix, (record.durationMs ?? 0) >= 1000 ? 33 : 90, color)}`;
  }
  const action = record.action ?? 'event';
  const failed = /failed|backpressure/.test(action);
  const service = /^maintenance|^jobs|^worker/.test(action)
    ? 'WORKER'
    : /^development/.test(action)
      ? 'DEV'
      : 'API';
  return `${prefix}${paint(failed ? '✕' : '●', failed ? 31 : 36, color)} ${paint(service.padEnd(7), 1, color)} ${paint(action, failed ? 31 : 36, color)}${record.code ? ' ' + paint(record.code, 33, color) : ''}`;
}

export type StartupInfo = {
  mode: 'development' | 'api';
  elapsedMs: number;
  runtime: string;
  engineVersion: string;
  dataDir: string;
  maxOwners: number;
  services: { studio?: string; docs?: string; api: string };
  /** Env file holding QB_BOOTSTRAP_TOKEN for first-owner setup. */
  bootstrapTokenEnv?: string;
};
function publicAddress(value: string) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return clean(url.toString().replace(/\/$/, ''));
  } catch {
    return '(invalid URL)';
  }
}

export function formatStartupPanel(
  info: StartupInfo,
  options: { color?: boolean; width?: number } = {},
) {
  const color = options.color ?? false;
  const width = Math.max(44, Math.min(100, options.width ?? 88));
  const inner = width - 4;
  const line = (value: string, tone = 37) =>
    `│ ${paint(fit(clean(value), inner).padEnd(inner), tone, color)} │`;
  const lines = [
    paint('╭' + '─'.repeat(width - 2) + '╮', 90, color),
    line(`◆  QB FLEX  /  ${info.mode === 'development' ? 'LOCAL DEVELOPMENT' : 'API SERVER'}`, 36),
    line(
      `Ready in ${(info.elapsedMs / 1000).toFixed(2)} s   ·   Bun ${info.runtime}   ·   PGlite ${info.engineVersion}`,
      32,
    ),
    line(''),
  ];
  for (const [service, address] of Object.entries(info.services)) {
    if (address)
      lines.push(
        line(
          `● ${service === 'api' ? 'API' : service[0]!.toUpperCase() + service.slice(1)}${' '.repeat(Math.max(1, 10 - service.length))}${publicAddress(address)}`,
          34,
        ),
      );
  }
  if (info.mode === 'development')
    lines.push(line('● Worker     Scheduled · jobs 2 s · maintenance 60 s', 32));
  lines.push(
    line(''),
    line('Data       ' + clean(info.dataDir), 90),
    line(`Owners     Up to ${info.maxOwners} active branches · one database owner each`, 90),
  );
  if (info.bootstrapTokenEnv)
    lines.push(
      line('Setup      ' + clean(info.bootstrapTokenEnv), 33),
      line('           QB_BOOTSTRAP_TOKEN · keep this file private', 33),
    );
  lines.push(
    line(''),
    line('Ctrl+C to shut down gracefully', 90),
    paint('╰' + '─'.repeat(width - 2) + '╯', 90, color),
  );
  return '\n' + lines.join('\n') + '\n';
}

export function printStartup(info: StartupInfo) {
  const settings = terminalSettings();
  if (settings.format === 'pretty')
    console.log(
      formatStartupPanel(info, { color: settings.color, width: process.stdout.columns || 88 }),
    );
  else
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        action: `${info.mode}.ready`,
        durationMs: Math.round(info.elapsedMs),
        runtime: `bun@${info.runtime}`,
        engine: `pglite@${info.engineVersion}`,
        services: Object.fromEntries(
          Object.entries(info.services).map(([name, address]) => [name, publicAddress(address!)]),
        ),
        dataDir: clean(info.dataDir),
        maxOwners: info.maxOwners,
        ...(info.bootstrapTokenEnv ? { bootstrapTokenEnv: clean(info.bootstrapTokenEnv) } : {}),
      }),
    );
}
