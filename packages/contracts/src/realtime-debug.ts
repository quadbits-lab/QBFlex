/** Realtime debugger (RTD-01). Metadata only — no row bodies or credentials. */
export const realtimeTraceStates = [
  'connecting',
  'joined',
  'replaying',
  'resync',
  'disconnected',
] as const;
export type RealtimeTraceState = (typeof realtimeTraceStates)[number];
export interface RealtimeTraceEntry {
  at: number;
  state: RealtimeTraceState;
  table: string | null;
  latencyMs: number | null;
  gap: number | null;
  detail: string | null;
}
export interface RealtimeDebugSession {
  id: string;
  identitySub: string | null;
  identityRole: string;
  createdAt: number;
  entries: RealtimeTraceEntry[];
}
