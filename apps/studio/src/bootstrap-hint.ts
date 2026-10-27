export type TokenSource = 'environment' | 'environment-file' | 'file' | 'none';

export type BootstrapHint = { message: string; commands: string[] };

export const generatedTokenPath = '/var/lib/qb-flex/bootstrap.token';
export const nativeTokenPath = '.data/bootstrap.token';

/**
 * Explain where the API reads the first-owner token. The API reports the source but
 * never the value, so the screen must point at a concrete command or location.
 */
export function bootstrapHint(source?: TokenSource): BootstrapHint {
  if (source === 'environment')
    return {
      message:
        'The API is reading QB_BOOTSTRAP_TOKEN from its environment. Use the exact value from your platform environment settings (for example Dokploy → Environment), or print it from the running container.',
      commands: [
        'docker exec $(docker ps -q -f name=api) printenv QB_BOOTSTRAP_TOKEN',
      ],
    };
  if (source === 'environment-file')
    return {
      message:
        'The API reads the token from the file named by QB_BOOTSTRAP_TOKEN_FILE. Open that mounted secret on the deployment host and use its contents.',
      commands: [],
    };
  if (source === 'file')
    return {
      message:
        'The API generated a one-time token in its data volume. Read it from the API container. Native installs keep it in the data directory instead.',
      commands: [`docker compose exec api cat ${generatedTokenPath}`, `cat ${nativeTokenPath}`],
    };
  return {
    message:
      'Use QB_BOOTSTRAP_TOKEN from the API environment. Without it, read the generated token from the API container (native installs keep it in the data directory).',
    commands: [`docker compose exec api cat ${generatedTokenPath}`, `cat ${nativeTokenPath}`],
  };
}
