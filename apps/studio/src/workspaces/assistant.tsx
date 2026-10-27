import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@qb-flex/ui';
import type { AssistantIntent, AssistantResponse } from '@qb-flex/contracts';
import { management } from '../api';

const INTENTS: { value: AssistantIntent; label: string }[] = [
  { value: 'explain', label: 'Explain' },
  { value: 'migration', label: 'Migration' },
  { value: 'policy', label: 'Policy' },
  { value: 'hook', label: 'Hook' },
];

export function AssistantWorkspace({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}) {
  const [intent, setIntent] = useState<AssistantIntent>('explain');
  const [prompt, setPrompt] = useState('');
  const [errorText, setErrorText] = useState('');
  const [result, setResult] = useState<AssistantResponse | null>(null);
  const propose = useMutation({
    mutationFn: () =>
      management.assistant(projectId, branchId).propose({
        intent,
        prompt,
        ...(errorText.trim() ? { error: errorText.trim() } : {}),
        includeRows: false,
      }),
    onSuccess: (response) => setResult(response.data),
  });
  const unconfigured = result ? !result.configured : false;
  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        The assistant proposes explanations, migrations, policies and hooks. It does not apply them.
        Migration proposals become schema reviews. Row values are not sent. Vector search remains
        planned. Set <span className="font-mono">QB_AI_BASE_URL</span>,{' '}
        <span className="font-mono">QB_AI_API_KEY</span> and <span className="font-mono">QB_AI_MODEL</span>{' '}
        on the API process before proposals can be generated.
      </div>
      {unconfigured && (
        <p role="status" className="rounded-xl border border-border bg-card p-4 text-sm">
          Assistant is unconfigured. Set QB_AI_BASE_URL, QB_AI_API_KEY and QB_AI_MODEL on the API,
          then submit again.
        </p>
      )}
      <form
        className="grid gap-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          propose.mutate();
        }}
      >
        <Field>
          <FieldLabel htmlFor="assistant-intent">Intent</FieldLabel>
          <Select value={intent} onValueChange={(value) => setIntent(value as AssistantIntent)}>
            <SelectTrigger id="assistant-intent" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTENTS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="assistant-prompt">Prompt</FieldLabel>
          <Textarea
            id="assistant-prompt"
            required
            className="min-h-32"
            maxLength={8000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the schema change or question"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="assistant-error">Sanitized error (optional)</FieldLabel>
          <Textarea
            id="assistant-error"
            className="min-h-20 font-mono text-xs"
            maxLength={4000}
            value={errorText}
            onChange={(event) => setErrorText(event.target.value)}
            spellCheck={false}
          />
        </Field>
        {propose.error && (
          <p role="alert" className="text-sm text-destructive">
            {propose.error.message}
          </p>
        )}
        <Button type="submit" className="w-fit" disabled={propose.isPending || !prompt.trim()}>
          {propose.isPending ? 'Proposing…' : 'Propose'}
        </Button>
      </form>
      {result && result.configured && !result.proposals.length && (
        <p className="m-0 text-sm text-muted-foreground">No proposals were returned.</p>
      )}
      {result?.proposals.map((proposal, index) => (
        <article key={`${proposal.kind}-${index}`} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{proposal.kind}</Badge>
            <h2 className="m-0 text-sm font-semibold">{proposal.title}</h2>
          </div>
          <pre className="mt-3 mb-0 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {proposal.body}
          </pre>
          {proposal.kind === 'migration' && proposal.reviewId && (
            <p className="mb-0 mt-3 text-sm">
              <Link to="/reviews" className="underline underline-offset-4">
                Open schema review {proposal.migrationId ?? proposal.reviewId}
              </Link>
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
