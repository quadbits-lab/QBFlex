#!/usr/bin/env node
import { readFileSync, existsSync, realpathSync, statSync, statfsSync } from 'node:fs';
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

/** Read-only Deployment Doctor foundation. No implicit probes, secret reads or writes. */
export async function doctor(directory, { env = process.env, probeURL } = {}) {
  const inventory = await diagnose(directory, { env, probeURL });
  const findings = [];
  const add = (code, severity, status, message, remediation) =>
    findings.push({ code, severity, status, message, remediation });
  const production = env.NODE_ENV === 'production';
  for (const name of ['QB_MASTER_KEY', 'QB_WORKER_TOKEN'])
    add(
      name + '_PRESENCE',
      production && !env[name] ? 'error' : 'info',
      env[name] ? 'pass' : 'unconfigured',
      name + (env[name] ? ' is present; value was not inspected.' : ' is not exported.'),
      'Inject the secret at runtime; do not expose it to browser bundles.',
    );
  const origin = (name, required) => {
    try {
      const value = env[name];
      if (!value) {
        add(
          name,
          required ? 'error' : 'warning',
          'unconfigured',
          name + ' is not exported.',
          'Configure an exact HTTP(S) origin.',
        );
        return;
      }
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hostname.includes('*') ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new Error();
      const secure = !production || url.protocol === 'https:';
      add(
        name,
        secure ? 'info' : 'error',
        secure ? 'pass' : 'fail',
        secure ? 'Origin syntax is valid.' : 'Production origin requires HTTPS.',
        'Use an exact HTTPS origin without credentials or paths.',
      );
    } catch {
      add(
        name,
        'error',
        'fail',
        'Invalid or credential-bearing origin; value redacted.',
        'Use an exact HTTP(S) origin without credentials or paths.',
      );
    }
  };
  origin('QB_PUBLIC_URL', production);
  origin('QB_STUDIO_URL', production);
  const allowed = (env.QB_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
  const invalidOrigins = allowed.some((value) => {
    try {
      const url = new URL(value.trim());
      return (
        !['https:', 'http:'].includes(url.protocol) ||
        !!url.username ||
        !!url.password ||
        url.hostname.includes('*') ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        (production && url.protocol !== 'https:')
      );
    } catch {
      return true;
    }
  });
  add(
    'ALLOWED_ORIGINS',
    invalidOrigins ? 'error' : allowed.length ? 'info' : 'warning',
    invalidOrigins ? 'fail' : allowed.length ? 'pass' : 'unconfigured',
    'Origin allowlist values are redacted.',
    'Configure explicit allowed origins; no wildcards or credentials.',
  );
  for (const finding of inventory.browserUnsafe)
    add(
      'BROWSER_SECRET',
      'error',
      'fail',
      'A public-prefixed variable has a credential-like name.',
      'Remove secret variables from public browser environment namespaces.',
    );
  const runtime = typeof Bun === 'undefined' ? null : Bun.version;
  const packageManifest = json(join(resolve(directory), 'package.json'));
  const expected = packageManifest?.packageManager?.startsWith('bun@')
    ? packageManifest.packageManager.slice(4)
    : null;
  add(
    'RUNTIME',
    expected && runtime && runtime !== expected ? 'error' : 'info',
    !runtime ? 'unknown' : expected && runtime !== expected ? 'fail' : 'pass',
    runtime
      ? 'Bun runtime detected; compare installed version with the workspace pin.'
      : 'Node helper cannot certify the Bun API runtime.',
    'Run qb doctor with the pinned Bun runtime and run compatibility gates.',
  );
  if (inventory.compatibility === 'version-mismatch-requires-verification')
    add(
      'SDK_VERSION',
      'warning',
      'unknown',
      'Installed SDK version differs from this helper baseline.',
      'Verify installed contracts and packed SDK consumers.',
    );
  const diskPath = resolve(directory, env.QB_DATA_DIR ?? '.data');
  if (!existsSync(diskPath))
    add(
      'DATA_DIRECTORY',
      'warning',
      'unconfigured',
      'Data directory does not exist; nothing was created.',
      'Create and mount a private persistent local directory during deployment.',
    );
  else {
    try {
      const info = statSync(diskPath);
      if (!info.isDirectory()) throw new Error();
      const disk = statfsSync(diskPath);
      const minimum = Number(env.QB_MIN_DISK_BYTES ?? 67108864);
      if (!Number.isSafeInteger(minimum) || minimum < 0) throw new Error();
      const free = disk.bavail * disk.bsize;
      add(
        'DISK_CAPACITY',
        free < minimum ? 'error' : 'info',
        free < minimum ? 'fail' : 'pass',
        'Free-space threshold checked; filesystem paths are not reported.',
        'Keep sufficient free space for WALs, staged archives and isolated restores.',
      );
      const unsafe = process.platform !== 'win32' && !!(info.mode & 0o022);
      add(
        'DISK_PERMISSIONS',
        unsafe ? 'warning' : 'info',
        unsafe ? 'fail' : 'pass',
        'Directory write-mode bits checked; this is not an ACL or mount certification.',
        'Restrict group/world writes and verify local disk ownership.',
      );
      add(
        'OWNER_FENCING',
        'info',
        'unknown',
        'Live database lease ownership is not inferred from a lock-file presence.',
        'Verify one API writer per local volume; do not share live files across hosts.',
      );
    } catch {
      add(
        'DATA_DIRECTORY',
        'error',
        'fail',
        'Data directory metadata cannot be inspected.',
        'Verify directory type, access and disk threshold configuration.',
      );
    }
  }
  const s3 = ['QB_S3_ENDPOINT', 'QB_S3_ACCESS_KEY', 'QB_S3_SECRET_KEY'];
  add(
    'STORAGE_CONFIG',
    s3.every((n) => env[n]) ? 'info' : 'warning',
    s3.every((n) => env[n]) ? 'unknown' : 'unconfigured',
    'Storage configuration presence does not prove connectivity.',
    'Configure the S3-compatible backend and run explicit isolated transfer verification.',
  );
  add(
    'EMAIL_CONFIG',
    'info',
    env.QB_RESEND_API_KEY || env.QB_SMTP_HOST ? 'unknown' : 'unconfigured',
    'Mail delivery was not attempted.',
    'Configure the existing mail adapter; use a separately authorized test recipient.',
  );
  add(
    'RECOVERY_DESTINATION',
    'info',
    'unknown',
    'Expanded off-node recovery destination checks are not implemented.',
    'Maintain separate object backups and master-key custody; follow the recovery runbook.',
  );
  add(
    'NATIVE_CERTIFICATION',
    'info',
    'unknown',
    'Native association/device certification is not implemented by this inventory.',
    'Run opt-in physical-device certification when native SDK support is available.',
  );
  if (env.QB_PUSH_ENABLED === 'true') {
    const configured =
      !!env.QB_PUSH_WORKER_TOKEN &&
      env.QB_PUSH_WORKER_TOKEN.length >= 32 &&
      env.QB_PUSH_WORKER_TOKEN !== env.QB_WORKER_TOKEN;
    add(
      'PUSH_WORKER_SECRET',
      configured ? 'info' : 'error',
      configured ? 'unknown' : 'fail',
      'Push lease credentials checked; no push was sent and campaigns remain planned.',
      'Use a distinct restricted worker secret; complete push implementation before enabling delivery.',
    );
  } else
    add(
      'PUSH_DISABLED',
      'info',
      'pass',
      'Push is disabled by default.',
      'Keep disabled until worker and device certification gates pass.',
    );
  if (probeURL)
    add(
      'API_READINESS',
      inventory.probe?.ready ? 'info' : 'error',
      inventory.probe?.ready ? 'pass' : 'fail',
      'Explicit read-only readiness probe completed.',
      'Inspect private owner/disk/service diagnostics; readiness does not certify providers.',
    );
  return {
    specificationVersion: '1.1',
    readOnly: true,
    exitStatus: findings.some((f) => f.severity === 'error') ? 1 : 0,
    findings,
    inventory,
  };
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
