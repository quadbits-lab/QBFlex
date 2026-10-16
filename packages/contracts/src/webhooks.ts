/** Secrets and event bodies never appear in subscription summaries. */
export interface WebhookInput {
  name: string;
  url: string;
  serviceKeyId: string;
  table: string;
  events: ('insert' | 'update' | 'delete')[];
  columns: string[];
}
export interface WebhookSummary {
  id: string;
  name: string;
  destinationOrigin: string;
  serviceKeyId: string;
  table: string;
  events: WebhookInput['events'];
  columns: string[];
  state: 'active' | 'paused' | 'revoked' | 'resync_required';
  checkpoint: number;
  createdAt: number;
  updatedAt: number;
  rotationUntil: number | null;
}
export interface WebhookDelivery {
  skipped: false;
  url: string;
  body: string;
  headers: Record<string, string>;
}
export interface WebhookSkip {
  skipped: true;
  code:
    | 'SUBSCRIPTION_INACTIVE'
    | 'KEY_REVOKED'
    | 'KEY_SCOPE'
    | 'EVENT_EXPIRED'
    | 'NOT_AUTHORIZED'
    | 'EVENT_TOO_LARGE';
}
