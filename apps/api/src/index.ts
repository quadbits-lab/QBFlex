import { createService } from './service';
import { REALTIME_LIMITS } from '@qb-flex/realtime';
import { QBError } from '@qb-flex/contracts';
import { log, printStartup } from '@qb-flex/observability';
export async function startService(override?: Parameters<typeof createService>[0]) {
  const service = await createService(override);
  type SocketData = {
    request: Request;
    project: string;
    branch: string;
    identity?: any;
    o?: any;
    headers?: Headers;
    table?: string;
    cursor: number;
    busy: boolean;
    lastSeen: number;
    timer?: ReturnType<typeof setInterval>;
  };
  const sockets = new Set<import('bun').ServerWebSocket<SocketData>>();
  const reservations = new Map<string, number>();
  let reserved = 0;
  const server = Bun.serve<SocketData>({
    port: service.config.port,
    hostname: process.env.QB_HOST ?? '127.0.0.1',
    maxRequestBodySize: 104857600,
    async fetch(request, server) {
      request.headers.delete('x-qb-client-ip');
      const address = server.requestIP(request)?.address;
      if (address) request.headers.set('x-qb-client-ip', address);
      const path = new URL(request.url).pathname;
      const match = path.match(/^\/v1\/projects\/([^/]+)\/branches\/([^/]+)\/realtime$/);
      if (match) {
        if (reserved >= 256 || (reservations.get(match[1]!) ?? 0) >= REALTIME_LIMITS.channels)
          return Response.json(
            {
              error: {
                code: 'QUOTA',
                message: 'Realtime connection quota exceeded',
                requestId: crypto.randomUUID(),
                retryable: true,
              },
            },
            { status: 429 },
          );
        reserved++;
        reservations.set(match[1]!, (reservations.get(match[1]!) ?? 0) + 1);
        if (
          server.upgrade(request, {
            data: {
              request,
              project: match[1]!,
              branch: match[2]!,
              cursor: 0,
              busy: false,
              lastSeen: Date.now(),
            },
          })
        )
          return;
        reserved--;
        reservations.set(match[1]!, (reservations.get(match[1]!) ?? 1) - 1);
        return new Response('WebSocket upgrade required', { status: 426 });
      }
      // Bound streaming JSON before parsing, including requests without Content-Length.
      if (request.body && !(request.method === 'PUT' && path.endsWith('/content'))) {
        const reader = request.body.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0,
          oversized = false;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) {
            oversized = true;
            await reader.cancel();
            break;
          }
          chunks.push(chunk.value);
        }
        const headers = new Headers(request.headers);
        headers.set('content-length', String(oversized ? 65537 : size));
        headers.delete('transfer-encoding');
        request = new Request(request, { headers, body: oversized ? '' : Buffer.concat(chunks) });
      }
      return service.app.fetch(request);
    },
    websocket: {
      maxPayloadLength: REALTIME_LIMITS.frameBytes,
      idleTimeout: 75,
      backpressureLimit: 262144,
      closeOnBackpressureLimit: true,
      open(ws) {
        sockets.add(ws);
        const deadline = setTimeout(() => {
          if (!ws.data.identity) ws.close(4001, 'Authenticate first');
        }, 5000);
        ws.data.timer = setInterval(async () => {
          if (Date.now() - ws.data.lastSeen > REALTIME_LIMITS.leaseMs) {
            ws.close(4001, 'Heartbeat expired');
            return;
          }
          if (!ws.data.headers || ws.data.busy) return;
          ws.data.busy = true;
          try {
            const access = await service.application(
              new Request(ws.data.request.url, { headers: ws.data.headers }),
              ws.data.project,
              ws.data.branch,
            );
            ws.data.identity = access.identity;
            ws.data.o = access.o;
            if (ws.data.table) {
              const result = await access.o.call('events', {
                after: ws.data.cursor,
                table: ws.data.table,
                identity: access.identity,
              });
              for (const event of result.events) {
                const frame = JSON.stringify(event);
                if (Buffer.byteLength(frame) > 65536)
                  throw new QBError('RESYNC_REQUIRED', 'Event exceeds the frame limit', 409);
                ws.send(frame);
              }
              ws.data.cursor = result.cursor;
              ws.send(JSON.stringify({ type: 'cursor', cursor: String(result.cursor) }));
            }
          } catch (error) {
            const code = error instanceof QBError ? error.code : 'OWNER_UNAVAILABLE';
            ws.send(JSON.stringify({ type: 'error', code }));
            ws.close(
              code === 'RESYNC_REQUIRED'
                ? 4002
                : error instanceof QBError && [401, 403].includes(error.status)
                  ? 4001
                  : 1012,
              code,
            );
          } finally {
            ws.data.busy = false;
          }
        }, 250);
        service.timers.add(ws.data.timer);
        void deadline;
      },
      async message(ws, message) {
        try {
          const input = JSON.parse(String(message));
          ws.data.lastSeen = Date.now();
          if (input.type === 'heartbeat') {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
            return;
          }
          if (input.type === 'join') {
            const headers = new Headers(ws.data.request.headers);
            headers.set('x-qb-key', input.publishableKey);
            if (input.token) headers.set('authorization', `Bearer ${input.token}`);
            const access = await service.application(
              new Request(ws.data.request.url, { headers }),
              ws.data.project,
              ws.data.branch,
            );
            const schema = await access.o.call('schema');
            if (!schema.tables.some((t: any) => t.name === input.table))
              throw new QBError('NOT_FOUND', 'Table not available', 404);
            ws.data.headers = headers;
            ws.data.identity = access.identity;
            ws.data.o = access.o;
            ws.data.table = input.table;
            ws.data.cursor =
              input.cursor !== undefined ? Number(input.cursor) : await access.o.call('latest');
            if (!Number.isSafeInteger(ws.data.cursor) || ws.data.cursor < 0)
              throw new QBError('INVALID_CURSOR', 'Invalid event cursor');
            ws.send(JSON.stringify({ type: 'joined', cursor: String(ws.data.cursor) }));
          } else if (input.type === 'leave') ws.data.table = undefined;
          else throw new QBError('VALIDATION', 'Unsupported realtime operation');
        } catch (error) {
          ws.send(
            JSON.stringify({
              type: 'error',
              code: error instanceof QBError ? error.code : 'VALIDATION',
            }),
          );
          ws.close(4001, 'Join failed');
        }
      },
      close(ws) {
        sockets.delete(ws);
        reserved--;
        const count = (reservations.get(ws.data.project) ?? 1) - 1;
        if (count) reservations.set(ws.data.project, count);
        else reservations.delete(ws.data.project);
        if (ws.data.timer) {
          clearInterval(ws.data.timer);
          service.timers.delete(ws.data.timer);
        }
      },
    },
  });
  log({ action: 'api.started' });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    for (const socket of sockets) socket.close(1012, 'Service restarting');
    const deadline = setTimeout(() => server.stop(true), 5000);
    await server.stop(false);
    clearTimeout(deadline);
    await service.close();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  return { ...service, server, close };
}
if (import.meta.main) {
  const began = performance.now();
  const service = await startService();
  if (process.env.QB_DEV_LAUNCHER !== '1') {
    const { dependencies } = await import('../../../package.json');
    const engineVersion = dependencies['@electric-sql/pglite'];
    printStartup({
      mode: 'api',
      elapsedMs: performance.now() - began,
      runtime: Bun.version,
      engineVersion,
      dataDir: service.config.dataDir,
      maxOwners: service.config.maxBranchOwners,
      services: { api: service.config.publicURL },
    });
  }
}
