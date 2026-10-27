/** Studio AI Assistant (section 16.3). Writes become schema reviews; never apply live. */
export type AssistantIntent = 'explain' | 'migration' | 'policy' | 'hook';
export interface AssistantRequest {
  intent: AssistantIntent;
  prompt: string;
  /** Optional sanitized error text. */
  error?: string;
  /** Explicit fixture rows only when the developer opts in. */
  fixtures?: Record<string, Record<string, unknown>[]>;
  includeRows?: boolean;
}
export interface AssistantProposal {
  kind: 'migration' | 'policy' | 'hook' | 'explanation';
  title: string;
  body: string;
  migrationId?: string;
  reviewId?: string | null;
}
export interface AssistantResponse {
  proposals: AssistantProposal[];
  model: string;
  configured: boolean;
}
