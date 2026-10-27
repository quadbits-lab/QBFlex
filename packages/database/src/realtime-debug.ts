import {
  QBError,
  type RealtimeDebugSession,
  type RealtimeTraceEntry,
  type RealtimeTraceState,
} from '@qb-flex/contracts';

const MAX_SESSIONS = 20;
const MAX_ENTRIES = 100;
const TTL_MS = 30 * 60 * 1000;

/** In-process metadata traces for RTD-01. Never stores row bodies or credentials. */
export class RealtimeDebugger {
  private sessions = new Map<string, RealtimeDebugSession & { expiresAt: number }>();
  constructor(private clock = Date.now) {}
  private prune() {
    const now = this.clock();
    for (const [id, session] of this.sessions)
      if (session.expiresAt <= now) this.sessions.delete(id);
  }
  list(): RealtimeDebugSession[] {
    this.prune();
    return [...this.sessions.values()].map(({ expiresAt: _, ...session }) => session);
  }
  open(input: { identitySub: string | null; identityRole: string }): RealtimeDebugSession {
    this.prune();
    if (this.sessions.size >= MAX_SESSIONS)
      throw new QBError('LIMIT_EXCEEDED', 'Too many realtime debug sessions');
    const role = input.identityRole;
    if (role !== 'anonymous' && role !== 'authenticated')
      throw new QBError('VALIDATION', 'Debug session requires an application identity role');
    if (role === 'authenticated' && !input.identitySub)
      throw new QBError('VALIDATION', 'Authenticated debug session requires a subject');
    if (role === 'anonymous' && input.identitySub !== null)
      throw new QBError('VALIDATION', 'Anonymous debug session must omit the subject');
    const id = crypto.randomUUID();
    const now = this.clock();
    const entry: RealtimeTraceEntry = {
      at: now,
      state: 'connecting',
      table: null,
      latencyMs: null,
      gap: null,
      detail: 'Session opened',
    };
    const session = {
      id,
      identitySub: input.identitySub,
      identityRole: role,
      createdAt: now,
      entries: [entry],
      expiresAt: now + TTL_MS,
    };
    this.sessions.set(id, session);
    const { expiresAt: _, ...publicSession } = session;
    return publicSession;
  }
  record(
    id: string,
    state: RealtimeTraceState,
    detail?: { table?: string; latencyMs?: number; gap?: number; detail?: string },
  ) {
    this.prune();
    const session = this.sessions.get(id);
    if (!session) throw new QBError('NOT_FOUND', 'Realtime debug session not found', 404);
    session.entries.push({
      at: this.clock(),
      state,
      table: detail?.table ?? null,
      latencyMs: detail?.latencyMs ?? null,
      gap: detail?.gap ?? null,
      detail: detail?.detail ?? null,
    });
    if (session.entries.length > MAX_ENTRIES)
      session.entries.splice(0, session.entries.length - MAX_ENTRIES);
    session.expiresAt = this.clock() + TTL_MS;
    const { expiresAt: _, ...publicSession } = session;
    return publicSession;
  }
}
