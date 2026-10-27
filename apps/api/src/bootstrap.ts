import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export type BootstrapSource = 'environment' | 'environment-file' | 'file' | 'none';

/** Example values shipped in .env templates; accepting them silently hides a real misconfiguration. */
const placeholders = new Set(['replace_with_openssl_rand_hex_32', 'replace-with-openssl-rand-hex-32']);

function readSecret(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Resolve the one-time first-owner token.
 *
 * Precedence is explicit so a deployment never silently falls back to a generated
 * file token while the operator holds a different value from the environment.
 * Values are trimmed because platform secret inputs commonly add a trailing newline.
 */
export function resolveBootstrapToken(options: {
  dataDir: string;
  hasOwner: boolean;
  env?: NodeJS.ProcessEnv;
}): { token?: string; source: BootstrapSource } {
  const env = options.env ?? process.env;
  const production = env.NODE_ENV === 'production';

  const environmentToken = env.QB_BOOTSTRAP_TOKEN?.trim();
  if (environmentToken) {
    if (production && placeholders.has(environmentToken))
      throw new Error(
        'QB_BOOTSTRAP_TOKEN still contains the example placeholder. Generate a real token with `openssl rand -hex 32`.',
      );
    return { token: environmentToken, source: 'environment' };
  }

  const secretFile = env.QB_BOOTSTRAP_TOKEN_FILE?.trim();
  if (secretFile) {
    const token = readSecret(secretFile);
    if (!token) throw new Error(`QB_BOOTSTRAP_TOKEN_FILE does not contain a token: ${secretFile}`);
    return { token, source: 'environment-file' };
  }

  if (options.hasOwner) return { source: 'none' };
  if (production)
    throw new Error(
      'QB_BOOTSTRAP_TOKEN is required for first-owner setup in production. Set it on the API service, or point QB_BOOTSTRAP_TOKEN_FILE at a mounted secret.',
    );

  const file = join(options.dataDir, 'bootstrap.token');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  const token = readSecret(file);
  if (!token) throw new Error(`Generated bootstrap token file is empty: ${file}`);
  return { token, source: 'file' };
}

/** Constant-time comparison after normalizing whitespace from form submission. */
export function bootstrapTokenMatches(supplied: unknown, expected: string | undefined): boolean {
  if (!expected) return false;
  const value = String(supplied ?? '').trim();
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
