import { useEffect, useId, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Field, FieldLabel, Textarea, toast } from '@qb-flex/ui';
import { management } from '../api';

export function useWrite() {
  return useMutation({
    mutationFn: async ({
      path,
      method = 'POST',
      body,
      headers,
    }: {
      path: string;
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    }) => management.request(path, method, body, undefined, headers),
  });
}

/** Create → rehearse → approve → apply a migration through the schema review gate. */
export async function applyReviewedMigration(
  base: string,
  migrationId: string,
  sql: string,
) {
  const created = await management.request<{ id: string }>(base + '/reviews', 'POST', {
    migrationId,
    sql,
  });
  await management.request(base + `/reviews/${created.data.id}/rehearse`, 'POST');
  await management.request(base + `/reviews/${created.data.id}/approve`, 'POST');
  return management.request(base + '/migrations', 'POST', { reviewId: created.data.id });
}

/** Surface query/mutation failures once via the global Sonner toaster. */
export function ErrorMessage({ error }: { error: Error | null | undefined }) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!error?.message) {
      last.current = null;
      return;
    }
    if (last.current === error.message) return;
    last.current = error.message;
    toast.error(error.message);
  }, [error]);
  return null;
}

export function download(content: string, name: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function JsonEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        className="min-h-52 font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </Field>
  );
}
