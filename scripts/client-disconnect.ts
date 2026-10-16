const DISCONNECT_CODES = new Set([
  'ABORT_ERR',
  'ECONNRESET',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
]);
const patched = Symbol.for('qbflex.quiet-client-disconnect');

type DisconnectError = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

function asDisconnectError(error: unknown): DisconnectError | undefined {
  if (!error || typeof error !== 'object') return undefined;
  return error as DisconnectError;
}

function hasAbortCause(error: unknown, depth = 0): boolean {
  const value = asDisconnectError(error);
  if (!value || depth > 4) return false;
  if (value.code === 'ECONNRESET' || value.message === 'aborted') return true;
  return hasAbortCause(value.cause, depth + 1);
}

/** True for a browser or proxy closing the socket before the response finishes. */
export function isClientDisconnect(error: unknown): boolean {
  const value = asDisconnectError(error);
  if (!value) return false;
  if (value.name === 'AbortError') return true;
  if (typeof value.code === 'string' && DISCONNECT_CODES.has(value.code)) return true;
  if (
    value.message === 'The operation was aborted.' ||
    value.message === 'The connection was closed.'
  )
    return true;
  return value.message === 'aborted' && hasAbortCause(value.cause);
}

export function ignoreClientDisconnectLogs() {
  const current = console.error as typeof console.error & { [patched]?: boolean };
  if (current[patched]) return;
  const original = current;
  const wrapped = ((...args: unknown[]) => {
    if (args.length === 1 && isClientDisconnect(args[0])) return;
    original.apply(console, args as Parameters<typeof console.error>);
  }) as typeof console.error & { [patched]?: boolean };
  wrapped[patched] = true;
  console.error = wrapped;
}

export function quietClientDisconnectPlugin() {
  return {
    name: 'qbflex:quiet-client-disconnect',
    configureServer() {
      ignoreClientDisconnectLogs();
    },
  };
}
