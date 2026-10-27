/** Permission-aware full-text search (SEA-01). */
export const searchCollectionStates = [
  'building',
  'ready',
  'invalidated',
  'rebuilding',
  'unsupported',
  'failed',
] as const;
export type SearchCollectionState = (typeof searchCollectionStates)[number];
export interface SearchCollectionInput {
  name: string;
  table: string;
  columns: string[];
}
export interface SearchCollectionSummary {
  id: string;
  name: string;
  table: string;
  columns: string[];
  state: SearchCollectionState;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}
export interface SearchQuery {
  collection: string;
  q: string;
  limit?: number;
  cursor?: string;
}
export interface SearchHit {
  id: string;
  table: string;
  rank: number;
  snippet: string | null;
  row: Record<string, unknown>;
}
export interface SearchResult {
  hits: SearchHit[];
  count: number | null;
  cursor: string | null;
}
