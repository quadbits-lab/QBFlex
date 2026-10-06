/** Additive metadata contract. Payloads and lease credentials are internal-only. */
export const jobKinds = [
  'recovery.drill', 'webhook.delivery', 'alert.email',
  'push.dispatch', 'push.receipts', 'maintenance',
] as const;
export type JobKind = (typeof jobKinds)[number];
export type JobState = 'queued' | 'leased' | 'retry_wait' | 'succeeded' | 'dead' | 'cancelled';
export interface JobSummary {
  id: string;
  eventId: string;
  kind: JobKind;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  deadlineAt: number;
  leaseUntil: number | null;
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  lastCode: string | null;
}
export interface JobAttempt {
  attempt: number;
  startedAt: number;
  finishedAt: number | null;
  outcome: 'leased' | 'succeeded' | 'retry_wait' | 'dead' | 'cancelled' | 'lease_expired';
  code: string | null;
}
