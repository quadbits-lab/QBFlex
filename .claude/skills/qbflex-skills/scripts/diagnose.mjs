#!/usr/bin/env node
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function json(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
export async function diagnose(directory, { env = process.env, probeURL } = {}) {
  const root = resolve(directory),
    manifest = json(join(root, 'package.json'));
  const linked = json(join(root, 'qb.json'));
  const versions = {};
  for (const [name, folder] of [
    ['@qb-flex/client', 'sdk-js'],
    ['@qb-flex/react', 'sdk-react'],
  ]) {
    const installed = json(join(root, 'node_modules', ...name.split('/'), 'package.json'));
    const source = json(join(root, 'packages', folder, 'package.json'));
    versions[name] = installed?.version ?? source?.version ?? 'not-installed';
  }
  // Do not read dotenv files, key files, or credential contents in linked configuration.
  const required = [
    'QB_MASTER_KEY',
    'QB_BOOTSTRAP_TOKEN',
    'QB_WORKER_TOKEN',
    'QB_S3_ENDPOINT',
    'QB_S3_ACCESS_KEY',
    'QB_S3_SECRET_KEY',
    'QB_SMTP_HOST',
    'QB_SMTP_PORT',
    'QB_MANAGEMENT_TOKEN',
  ];
  const presence = Object.fromEntries(
    required.map((name) => [name, Boolean(env[name]) ? 'set' : 'missing']),
  );
  const browserUnsafe = Object.keys(env)
    .filter(
      (name) =>
        /^(VITE_|NEXT_PUBLIC_|PUBLIC_)/.test(name) &&
        /SERVICE|MANAGEMENT|MASTER|BOOTSTRAP|WORKER|SECRET|PASSWORD|PRIVATE/.test(name) &&
        Boolean(env[name]),
    )
    .map((name) => ({ variable: name, status: 'unsafe-browser-credential-name' }));
  const result = {
    skillVersion: '0.1.0',
    sourceVersion: manifest?.name === 'qb-flex' ? manifest.version : null,
    sdkVersions: versions,
    compatibility: Object.values(versions).every((v) => v === '0.1.0' || v === 'not-installed')
      ? 'verify-configured-0.1.0-target'
      : 'version-mismatch-requires-verification',
    target: {
      url: linked?.url || env.QB_PUBLIC_URL ? 'configured' : 'missing',
      project: linked?.project || env.QB_PROJECT_ID ? 'configured' : 'missing',
      branch: linked?.branch || env.QB_BRANCH ? 'configured' : 'default-primary-needs-confirmation',
      publishableKey: env.VITE_QB_PUBLISHABLE_KEY || env.QB_PUBLISHABLE_KEY ? 'set' : 'missing',
    },
    files: {
      linkedConfiguration: existsSync(join(root, 'qb.json')),
      dotenv: existsSync(join(root, '.env')),
      lockfile: ['bun.lock', 'package-lock.json', 'pnpm-lock.yaml'].some((f) =>
        existsSync(join(root, f)),
      ),
    },
    environment: presence,
    browserUnsafe,
    notes: [
      'No secret values or filesystem paths are reported.',
      'Dotenv is not read; missing values mean they were not exported to this helper.',
      'Missing external configuration is not proof of a product defect.',
      'Inspect the authorized exposed schema and project capabilities before development.',
    ],
  };
  if (probeURL) {
    let url;
    try {
      url = new URL(probeURL);
    } catch {
      throw new Error('Probe requires a valid HTTP(S) origin');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Probe requires a bare HTTP(S) origin without credentials');
    try {
      const response = await fetch(new URL('/ready', url), {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      result.probe = { endpoint: '/ready', status: response.status, ready: response.ok };
    } catch {
      result.probe = { endpoint: '/ready', ready: false, error: 'unreachable-or-timeout' };
    }
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2)
      if (!['--directory', '--probe-url'].includes(args[i]) || !args[i + 1])
        throw new Error('Use --directory <target> [--probe-url <origin>]');
    const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    console.log(
      JSON.stringify(
        await diagnose(option('--directory') ?? '.', { probeURL: option('--probe-url') }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
