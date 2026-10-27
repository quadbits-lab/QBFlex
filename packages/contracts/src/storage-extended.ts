/** Resumable uploads (tus) and bounded image transforms. */
export interface ResumableUploadSession {
  id: string;
  objectId: string;
  bucketId: string;
  key: string;
  offset: number;
  length: number;
  expiresAt: string;
}
export interface TransformOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}
export interface RowAccessIdentity {
  sub: string | null;
  role: 'anonymous' | 'authenticated';
  roles?: string[];
}
export interface RowAccessRequest {
  table: string;
  key: string;
  identities: RowAccessIdentity[];
}
export interface RowAccessResult {
  identity: RowAccessIdentity;
  select: boolean;
  insert: boolean | null;
  update: boolean | null;
  delete: boolean | null;
  columns: string[];
}
