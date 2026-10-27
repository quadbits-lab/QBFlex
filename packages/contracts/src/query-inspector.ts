/** Query Inspector (QIN-01). Fingerprints never include parameter values. */
export type InspectorRequestState = 'queued' | 'planned' | 'failed';
export interface QuerySample {
  id: string;
  fingerprint: string;
  table: string;
  operation: 'select';
  durationMs: number;
  sampledAt: string;
  count: number;
}
export interface IndexSuggestion {
  table: string;
  columns: string[];
  reason: string;
}
export interface QueryPlanResult {
  id: string;
  state: InspectorRequestState;
  fingerprint: string;
  plan: unknown | null;
  suggestions: IndexSuggestion[];
  error: string | null;
}
