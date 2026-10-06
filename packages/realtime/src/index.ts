export const REALTIME_VERSION = 1;
export const REALTIME_LIMITS = {
  frameBytes: 65536,
  heartbeatMs: 25000,
  leaseMs: 75000,
  channels: 100,
};
export interface RowEvent {
  type: 'database';
  eventId: string;
  table: string;
  event: 'insert' | 'update' | 'delete';
  payload: Record<string, unknown>;
  schemaVersion: number;
}
