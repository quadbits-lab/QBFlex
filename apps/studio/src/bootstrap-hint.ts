export type TokenSource = 'environment' | 'none';

export type BootstrapHint = { message: string; commands: string[] };

export const envVariable = 'QB_BOOTSTRAP_TOKEN';

/**
 * Explain where the API reads the first-owner token. The token is env-only, so the
 * guidance is the same for every deployment: use the configured value.
 */
export function bootstrapHint(source?: TokenSource): BootstrapHint {
  if (source === 'none')
    return {
      message: `First-owner setup is already complete; ${envVariable} is not needed.`,
      commands: [],
    };
  return {
    message: `Use the exact ${envVariable} value configured for the API — the same value in its environment or .env file. Generate one with: openssl rand -hex 32`,
    commands: [`docker compose exec api printenv ${envVariable}`],
  };
}
