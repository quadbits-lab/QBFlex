/** Stable browser and service contracts. No runtime or filesystem dependencies. */
export const API_VERSION = 'v1';
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
}
export interface Filter {
  column: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'isNull' | 'like';
  value?: Scalar | Scalar[];
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
} as const;
export const routes = [
  ['GET', '/health', 'Health operation'],
  ['GET', '/ready', 'Ready operation'],
  ['GET', '/setup', 'Setup operation'],
  ['POST', '/setup', 'Setup operation'],
  ['GET/POST', '/platform/auth/*', '* operation'],
  ['GET', '/management/v1/capabilities', 'Feature availability'],
  ['GET', '/management/v1/organizations', 'List organizations'],
  ['POST', '/management/v1/organizations', 'Create organization'],
  ['GET', '/management/v1/organizations/{id}/members', 'Members operation'],
  ['POST', '/management/v1/organizations/{id}/members', 'Members operation'],
  ['POST', '/management/v1/invitations', 'Invitations operation'],
  ['POST', '/management/v1/tokens', 'Tokens operation'],
  ['GET', '/management/v1/tokens', 'Tokens operation'],
  ['DELETE', '/management/v1/tokens/{token}', 'Token operation'],
  ['GET', '/management/v1/projects', 'List projects'],
  ['POST', '/management/v1/projects', 'Provision project'],
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
  ['POST', '/management/v1/projects/{id}/branches/{branch}/sql', 'Execute privileged SQL'],
  ['GET', '/management/v1/projects/{id}/branches/{branch}/policies', 'Policies operation'],
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
  [
    'DELETE',
    '/management/v1/projects/{id}/branches/{branch}/users/{user}/sessions',
    'Sessions operation',
  ],
  ['GET', '/management/v1/projects/{id}/backups', 'Backups operation'],
  ['POST', '/management/v1/projects/{id}/branches/{branch}/backups', 'Backups operation'],
  ['POST', '/management/v1/projects/{id}/backups/{backup}/restore', 'Restore operation'],
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
    'DELETE',
    '/v1/projects/{projectId}/branches/{branchId}/storage/objects/{object}',
    'Object operation',
  ],
  ['WS', '/v1/projects/{projectId}/branches/{branchId}/realtime', 'Authorized row subscriptions'],
] as const;
