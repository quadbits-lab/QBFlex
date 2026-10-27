import { timingSafeEqual } from 'node:crypto';

export type BootstrapSource = 'environment' | 'none';

/** Example values shipped in .env templates; accepting them silently hides a real misconfiguration. */
const placeholders = new Set(['replace_with_openssl_rand_hex_32', 'replace-with-openssl-rand-hex-32']);

/**
 * Resolve the one-time first-owner token.
 *
 * The token comes from `QB_BOOTSTRAP_TOKEN` only — the environment or `.env` file the
 * deployment already loads. There is no generated token file, so the value the operator
 * holds is always the value the API compares against. The variable is required until an
 * owner exists; afterwards it is optional, so restarts keep working if it was removed.
 */
export function resolveBootstrapToken(options: {
  hasOwner: boolean;
  configured?: string;
  env?: NodeJS.ProcessEnv;
}): { token?: string; source: BootstrapSource } {
  const env = options.env ?? process.env;
  if (options.hasOwner) return { source: 'none' };

  // Trailing newlines and surrounding quotes are common when pasting into platform UIs.
  const token = normalize((options.configured ?? env.QB_BOOTSTRAP_TOKEN) as string | undefined);
  if (!token)
    throw new Error(
      'QB_BOOTSTRAP_TOKEN is required for first-owner setup. Set it in the API environment or .env file, for example: openssl rand -hex 32',
    );
  if (placeholders.has(token))
    throw new Error(
      'QB_BOOTSTRAP_TOKEN still contains the example placeholder. Generate a real token with `openssl rand -hex 32`.',
    );
  return { token, source: 'environment' };
}

export function normalize(value: string | undefined): string {
  return (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

/** Constant-time comparison after normalizing whitespace from form submission. */
export function bootstrapTokenMatches(supplied: unknown, expected: string | undefined): boolean {
  if (!expected) return false;
  const value = String(supplied ?? '').trim();
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
