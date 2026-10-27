/** Stable browser and service contracts. No runtime or filesystem dependencies. */
export const API_VERSION = 'v1';
export { jobKinds } from './jobs';
export type { JobKind, JobState, JobSummary, JobAttempt } from './jobs';
export type { WebhookInput, WebhookSummary, WebhookDelivery, WebhookSkip } from './webhooks';
export type { SecurityFinding, SecurityReport } from './security-advisor';
export {
  recoveryIntervals,
  replicaStates,
  drillStates,
  recoveryFindingCodes,
} from './recovery';
export type {
  RecoveryIntervalHours,
  ReplicaState,
  DrillState,
  RecoveryFindingCode,
  DrillDimensionResult,
  RecoverySettings,
  RecoveryDestinationSummary,
  RecoveryDestinationInput,
  BackupReplicaSummary,
  RecoveryInventoryItem,
  RecoveryFinding,
  RecoveryInventory,
  RecoveryDrillReport,
  RecoveryDrillSummary,
} from './recovery';
export { reviewStates, previewStates } from './schema-reviews';
export type {
  ReviewState,
  PreviewState,
  DestructiveKind,
  DestructiveFinding,
  SchemaReviewSummary,
  SchemaReviewInput,
  SchemaReviewDetail,
  PreviewSummary,
  PreviewInput,
} from './schema-reviews';
export { searchCollectionStates } from './search';
export type {
  SearchCollectionState,
  SearchCollectionInput,
  SearchCollectionSummary,
  SearchQuery,
  SearchHit,
  SearchResult,
} from './search';
export type {
  InspectorRequestState,
  QuerySample,
  IndexSuggestion,
  QueryPlanResult,
} from './query-inspector';
export { realtimeTraceStates } from './realtime-debug';
export type {
  RealtimeTraceState,
  RealtimeTraceEntry,
  RealtimeDebugSession,
} from './realtime-debug';
export type { AssistantIntent, AssistantRequest, AssistantProposal, AssistantResponse } from './assistant';
export type {
  ResumableUploadSession,
  TransformOptions,
  RowAccessIdentity,
  RowAccessRequest,
  RowAccessResult,
} from './storage-extended';
export type Role = 'owner' | 'admin' | 'developer' | 'viewer';
export type Operation = 'select' | 'insert' | 'update' | 'delete';
export type Scalar = string | number | boolean | null;
export type Operand = { column: string } | { claim: 'sub' | 'role' } | { value: Scalar };
export type Expression =
  | { op: 'and' | 'or'; args: Expression[] }
  | { op: 'not'; arg: Expression }
  | { op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; left: Operand; right: Operand }
  | { op: 'in'; left: Operand; values: Scalar[] }
  | { op: 'isNull'; arg: Operand }
  | { op: 'exists'; relationship: string; where: Expression }
  | { op: 'true' | 'false' };
export interface Policy {
  id?: string;
  resource: string;
  operation: Operation;
  roles: string[];
  mode: 'permissive' | 'restrictive';
  using: Expression;
  check: Expression;
  enabled: boolean;
}
export interface Identity {
  sub: string | null;
  role: 'anonymous' | 'authenticated' | 'service';
  /** Application RBAC role names. Empty/omitted for anonymous, service, or users without assignments. */
  roles?: string[];
}
export const SYSTEM_POLICY_ROLES = ['anonymous', 'authenticated', 'service'] as const;
export type SystemPolicyRole = (typeof SYSTEM_POLICY_ROLES)[number];
export const APP_ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
export function isReservedRoleName(name: string) {
  return (SYSTEM_POLICY_ROLES as readonly string[]).includes(name);
}
export interface Filter {
  column: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'isNull' | 'like';
  value?: Scalar | Scalar[];
}
export interface AggregateExpr {
  alias: string;
  fn: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';
  column?: string;
}
export interface HavingClause {
  alias: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  value: Scalar;
}
export interface Relationship {
  name: string;
  source: string;
  target: string;
  localColumn: string;
  foreignColumn: string;
  cardinality: 'one' | 'many';
}
export interface RPCOperation {
  name: string;
  table: string;
  kind: 'query' | 'insert' | 'update' | 'delete';
  args: Record<string, 'string' | 'number' | 'boolean'>;
  query?: Query;
  values?: Record<string, Scalar | { arg: string } | { claim: 'sub' }>;
  keyArg?: string;
}
export interface Query {
  columns?: string[];
  filters?: Filter[];
  order?: { column: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  cursor?: string;
  count?: boolean;
  relations?: { name: string; columns?: string[]; limit?: number }[];
  groupBy?: string[];
  aggregates?: AggregateExpr[];
  having?: HavingClause[];
}
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  primaryKey: number;
  generated?: boolean;
  enum?: Scalar[];
}
export interface TableSchema {
  name: string;
  columns: Column[];
  exposed: boolean;
  allowedColumns: string[];
  indexes: unknown[];
  foreignKeys: unknown[];
  relationships?: Relationship[];
}
export interface Session {
  token?: string;
  user: { id: string; email: string; name: string };
  expiresAt?: string;
}
export interface Result<T> {
  data: T;
  meta: {
    requestId: string;
    schemaVersion?: number;
    cursor?: string;
    count?: number;
    consistencyToken?: string;
  };
}
export interface Failure {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
    retryable: boolean;
  };
}
export interface DatabaseShape {
  [table: string]: {
    Row: Record<string, unknown>;
    Insert: Record<string, unknown>;
    Update: Record<string, unknown>;
  };
}
export type RelationsOf<D, K extends keyof D> = D[K] extends { Relationships: infer R }
  ? R
  : Record<string, unknown>;
export type RowOf<D, K extends keyof D> = D[K] extends { Row: infer R } ? R : never;
export type InsertOf<D, K extends keyof D> = D[K] extends { Insert: infer R } ? R : never;
export type UpdateOf<D, K extends keyof D> = D[K] extends { Update: infer R } ? R : never;
export class QBError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'QBError';
  }
}
export const capabilities = {
  organizations: 'available',
  projects: 'available',
  database: 'available',
  rest: 'available',
  policies: 'available',
  auth: 'available',
  realtime: 'available',
  storage: 'configured',
  backups: 'available',
  graphql: 'planned',
  branching: 'planned',
  functions: 'planned',
  ai: 'planned',
  mcp: 'planned',
  replicas: 'planned',
  jobs: 'experimental',
  recoveryCenter: 'experimental',
  securityAdvisor: 'experimental',
  operationsDashboard: 'planned',
  queryInspector: 'available',
  schemaReviews: 'available',
  previews: 'available',
  webhooks: 'experimental',
  dataLab: 'available',
  search: 'available',
  nativeSDK: 'planned',
  push: 'planned',
  assistant: 'configured',
  magicLinks: 'available',
  resumableUploads: 'available',
  imageTransforms: 'available',
  realtimeDebugger: 'available',
  rowAccess: 'available',
} as const;
export const routes = [
  ['GET', '/health', 'Health operation'],
  ['GET', '/ready', 'Ready operation'],
  ['GET', '/setup', 'Setup operation'],
  ['POST', '/setup', 'Setup operation'],
  ['GET/POST', '/platform/auth/*', '* operation'],
  ['GET', '/platform/avatars/{userId}', 'Read platform avatar'],
  ['POST', '/platform/avatar', 'Upload platform avatar'],
  ['DELETE', '/platform/avatar', 'Remove platform avatar'],
  ['GET', '/management/v1/capabilities', 'Feature availability'],
  ['GET', '/management/v1/organizations', 'List organizations'],
  ['POST', '/management/v1/organizations', 'Create organization'],
  ['GET', '/management/v1/organizations/{id}', 'Read workspace'],
  ['PATCH', '/management/v1/organizations/{id}', 'Update workspace'],
  ['POST', '/management/v1/organizations/{id}/archive', 'Archive workspace'],
  ['POST', '/management/v1/organizations/{id}/unarchive', 'Restore workspace'],
  ['DELETE', '/management/v1/organizations/{id}', 'Delete workspace'],
  ['GET', '/management/v1/organizations/{id}/members', 'Members operation'],
  ['POST', '/management/v1/organizations/{id}/members', 'Members operation'],
  ['POST', '/management/v1/invitations', 'Invitations operation'],
  ['POST', '/management/v1/tokens', 'Tokens operation'],
  ['GET', '/management/v1/tokens', 'Tokens operation'],
  ['DELETE', '/management/v1/tokens/{token}', 'Token operation'],
  ['GET', '/management/v1/projects', 'List projects'],
  ['POST', '/management/v1/projects', 'Provision project'],
  ['PATCH', '/management/v1/projects/{id}', 'Update project name and region'],
  ['DELETE', '/management/v1/projects/{id}', 'Delete project and its artifacts'],
  ['GET', '/management/v1/operations/{id}', 'Operation status'],
  ['POST', '/management/v1/operations/{id}/cancel', 'Cancel before provisioning starts'],
  ['GET', '/management/v1/projects/{id}/branches', 'List branches'],
  ['GET', '/management/v1/projects/{id}/keys', 'List keys'],
  ['POST', '/management/v1/projects/{id}/keys', 'Create key'],
  ['DELETE', '/management/v1/projects/{id}/keys/{key}', 'Key operation'],
  ['GET', '/management/v1/projects/{id}/config', 'Config operation'],
  ['PUT', '/management/v1/projects/{id}/config', 'Config operation'],
  ['PUT', '/management/v1/projects/{id}/secrets/{name}', 'Name operation'],
  ['GET', '/management/v1/projects/{id}/secrets', 'Secrets operation'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/schema', 'Inspect schema'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/data/{table}', 'Table operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/data/{table}', 'Table operation'],
  ['PATCH', '/management/v1/projects/{id}/branches/{branch}/data/{table}/{key}', 'Key operation'],
  ['DELETE', '/management/v1/projects/{id}/branches/{branch}/data/{table}/{key}', 'Key operation'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/migrations', 'Migrations operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/migrations', 'Apply migration'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/reviews', 'List schema reviews'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/reviews', 'Create schema review'],
  [
    'GET',
    '/management/v1/projects/{id}/branches/{branch}/reviews/{review}',
    'Read schema review',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/reviews/{review}/rehearse',
    'Rehearse schema review',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/reviews/{review}/approve',
    'Approve schema review',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/reviews/{review}/reject',
    'Reject schema review',
  ],
  ['GET', '/management/v1/projects/{id}/previews', 'List disposable previews'],
  ['POST', '/management/v1/projects/{id}/previews', 'Create disposable preview'],
  ['GET', '/management/v1/projects/{id}/previews/{preview}', 'Preview status'],
  ['POST', '/management/v1/projects/{id}/previews/{preview}/extend', 'Extend preview TTL'],
  ['DELETE', '/management/v1/projects/{id}/previews/{preview}', 'Delete preview'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/sql', 'Execute privileged SQL'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/policies', 'Policies operation'],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/policies/access',
    'Evaluate row access for identities',
  ],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/webhooks', 'Webhook metadata'],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/webhooks/{webhook}/sample',
    'Build signed sample webhook event',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/webhooks/{webhook}/deliver-sample',
    'Deliver signed sample webhook event',
  ],
  [
    'GET',
    '/management/v1/projects/{id}/branches/{branch}/search/collections',
    'List search collections',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/search/collections',
    'Register search collection',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/search/collections/{collection}/rebuild',
    'Rebuild search collection',
  ],
  [
    'DELETE',
    '/management/v1/projects/{id}/branches/{branch}/search/collections/{collection}',
    'Delete search collection',
  ],
  [
    'GET',
    '/management/v1/projects/{id}/branches/{branch}/inspector/samples',
    'List slow query samples',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/inspector/plan',
    'Explain a sampled query fingerprint',
  ],
  [
    'GET',
    '/management/v1/projects/{id}/branches/{branch}/realtime/debug',
    'List realtime debug sessions',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/realtime/debug',
    'Open realtime debug session',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/assistant',
    'Studio assistant proposal',
  ],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/security', 'Security Advisor findings'],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/security/{finding}/acknowledge',
    'Acknowledge current finding with expiry',
  ],
  [
    'DELETE',
    '/management/v1/projects/{id}/branches/{branch}/security/{finding}/acknowledge',
    'Clear finding acknowledgment',
  ],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/webhooks', 'Create scoped webhook'],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/webhooks/{webhook}/state',
    'Pause, resume or revoke webhook',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/webhooks/{webhook}/rotate',
    'Rotate webhook signing secret',
  ],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/jobs', 'List private job metadata'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/jobs/{job}', 'Job attempt history'],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/jobs/{job}/cancel',
    'Cancel unsent job work',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/jobs/{job}/replay',
    'Explicit dead-letter replay',
  ],
  ['PUT', '/management/v1/projects/{id}/branches/{branch}/policies', 'Save policy'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/policies/test', 'Test operation'],
  ['PUT', '/management/v1/projects/{id}/branches/{branch}/exposure/{table}', 'Configure exposure'],
  [
    'PUT',
    '/management/v1/projects/{id}/branches/{branch}/relationships',
    'Relationships operation',
  ],
  ['PUT', '/management/v1/projects/{id}/branches/{branch}/rpc', 'Rpc operation'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/rpc', 'Rpc operation'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/types', 'Types operation'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/users', 'Users operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/users', 'Users operation'],
  ['PATCH', '/management/v1/projects/{id}/branches/{branch}/users/{user}', 'Users operation'],
  ['DELETE', '/management/v1/projects/{id}/branches/{branch}/users/{user}', 'Users operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/users/{user}/ban', 'Users operation'],
  ['DELETE', '/management/v1/projects/{id}/branches/{branch}/users/{user}/ban', 'Users operation'],
  ['PUT', '/management/v1/projects/{id}/branches/{branch}/users/{user}/roles', 'Users operation'],
  [
    'DELETE',
    '/management/v1/projects/{id}/branches/{branch}/users/{user}/sessions',
    'Sessions operation',
  ],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/roles', 'Roles operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/roles', 'Roles operation'],
  ['PATCH', '/management/v1/projects/{id}/branches/{branch}/roles/{role}', 'Roles operation'],
  ['DELETE', '/management/v1/projects/{id}/branches/{branch}/roles/{role}', 'Roles operation'],
  ['GET', '/management/v1/projects/{id}/backups', 'Backups operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/backups', 'Backups operation'],
  ['POST', '/management/v1/projects/{id}/backups/{backup}/restore', 'Restore operation'],
  ['GET', '/management/v1/projects/{id}/recovery', 'Recovery settings'],
  ['PUT', '/management/v1/projects/{id}/recovery', 'Recovery settings'],
  ['GET', '/management/v1/projects/{id}/recovery/destinations', 'Recovery destinations'],
  ['POST', '/management/v1/projects/{id}/recovery/destinations', 'Recovery destinations'],
  [
    'POST',
    '/management/v1/projects/{id}/recovery/destinations/{destination}/state',
    'Recovery destination state',
  ],
  ['GET', '/management/v1/projects/{id}/recovery/inventory', 'Recovery inventory'],
  ['GET', '/management/v1/projects/{id}/recovery/drills', 'Recovery drills'],
  ['POST', '/management/v1/projects/{id}/recovery/drills', 'Recovery drills'],
  ['POST', '/management/v1/projects/{id}/recovery/drills/{drill}/cancel', 'Cancel recovery drill'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/cutover', 'Cutover operation'],
  ['GET', '/management/v1/audit', 'Audit operation'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/buckets', 'Buckets operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/buckets', 'Buckets operation'],
  [
    'GET',
    '/management/v1/projects/{id}/branches/{branch}/buckets/{bucket}/objects',
    'Objects operation',
  ],
  [
    'POST',
    '/management/v1/projects/{id}/branches/{branch}/buckets/{bucket}/objects',
    'Objects operation',
  ],
  [
    'PUT',
    '/management/v1/projects/{id}/branches/{branch}/objects/{object}/content',
    'Content operation',
  ],
  [
    'GET',
    '/management/v1/projects/{id}/branches/{branch}/objects/{object}/content',
    'Content operation',
  ],
  ['DELETE', '/management/v1/projects/{id}/branches/{branch}/objects/{object}', 'Object operation'],
  ['GET/POST', '/v1/projects/{projectId}/branches/{branchId}/auth/*', '* operation'],
  ['POST', '/v1/projects/{projectId}/branches/{branchId}/rpc/{operation}', 'Operation operation'],
  ['GET', '/v1/projects/{projectId}/branches/{branchId}/schema', 'Exposed schema'],
  ['GET', '/v1/projects/{projectId}/branches/{branchId}/openapi.json', 'Generated OpenAPI'],
  ['GET', '/v1/projects/{projectId}/branches/{branchId}/data/{table}', 'Read authorized rows'],
  ['POST', '/v1/projects/{projectId}/branches/{branchId}/data/{table}/query', 'Structured query'],
  ['POST', '/v1/projects/{projectId}/branches/{branchId}/data/{table}', 'Insert rows'],
  ['POST', '/v1/projects/{projectId}/branches/{branchId}/data/{table}/upsert', 'Upsert operation'],
  ['PATCH', '/v1/projects/{projectId}/branches/{branchId}/data/{table}/{key}', 'Update row'],
  ['DELETE', '/v1/projects/{projectId}/branches/{branchId}/data/{table}/{key}', 'Delete row'],
  ['POST', '/v1/projects/{projectId}/branches/{branchId}/search', 'Permission-aware full-text search'],
  ['GET', '/v1/projects/{projectId}/branches/{branchId}/storage/buckets', 'Buckets operation'],
  [
    'GET',
    '/v1/projects/{projectId}/branches/{branchId}/storage/buckets/{bucket}/objects',
    'Objects operation',
  ],
  [
    'POST',
    '/v1/projects/{projectId}/branches/{branchId}/storage/buckets/{bucket}/objects',
    'Objects operation',
  ],
  [
    'POST',
    '/v1/projects/{projectId}/branches/{branchId}/storage/buckets/{bucket}/resumable',
    'Create resumable upload session',
  ],
  [
    'HEAD',
    '/v1/projects/{projectId}/branches/{branchId}/storage/resumable/{upload}',
    'Read resumable upload offset',
  ],
  [
    'PATCH',
    '/v1/projects/{projectId}/branches/{branchId}/storage/resumable/{upload}',
    'Append resumable upload chunk',
  ],
  [
    'DELETE',
    '/v1/projects/{projectId}/branches/{branchId}/storage/resumable/{upload}',
    'Abort resumable upload',
  ],
  [
    'PUT',
    '/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}/content',
    'Content operation',
  ],
  [
    'GET',
    '/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}/content',
    'Content operation',
  ],
  [
    'GET',
    '/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}/transform',
    'Bounded image transform',
  ],
  [
    'DELETE',
    '/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}',
    'Object operation',
  ],
  ['WS', '/v1/projects/{projectId}/branches/{branchId}/realtime', 'Authorized row subscriptions'],
] as const;
