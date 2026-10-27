/** Schema change review (REV-01) and disposable preview (PRE-01) contracts. */
export const reviewStates = [
  'draft',
  'rehearsed',
  'approved',
  'applied',
  'stale',
  'rejected',
] as const;
export type ReviewState = (typeof reviewStates)[number];
export const previewStates = [
  'queued',
  'provisioning',
  'ready',
  'expiring',
  'deleting',
  'deleted',
  'failed',
] as const;
export type PreviewState = (typeof previewStates)[number];
export type DestructiveKind =
  | 'drop_table'
  | 'drop_column'
  | 'alter_type'
  | 'delete_rows'
  | 'truncate'
  | 'rename';
export interface DestructiveFinding {
  kind: DestructiveKind;
  detail: string;
}
export interface SchemaReviewSummary {
  id: string;
  migrationId: string;
  digest: string;
  baseSchemaVersion: number;
  state: ReviewState;
  destructive: DestructiveFinding[];
  author: string;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  rehearsalNotes: string | null;
}
export interface SchemaReviewInput {
  migrationId: string;
  sql: string;
}
export interface SchemaReviewDetail extends SchemaReviewSummary {
  sql: string;
  typeCheckOk: boolean | null;
}
export interface PreviewSummary {
  id: string;
  projectId: string;
  name: string;
  state: PreviewState;
  expiresAt: string;
  createdAt: string;
  error: string | null;
}
export interface PreviewInput {
  name?: string;
  fixtures?: Record<string, Record<string, unknown>[]>;
  /** Hours until expiry; default 72, max 168 (7 days). */
  ttlHours?: number;
}
