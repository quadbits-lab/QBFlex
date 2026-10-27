import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  defaultNpmTag,
  isSemver,
  publicSDKPackages,
  readSDKManifest,
  sdkTarballPath,
} from './sdk-packages';

type Manifest = Record<string, any>;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeManifest(path: string, manifest: Manifest) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function validateSDKReleaseMetadata() {
  const [client, react] = await Promise.all(publicSDKPackages.map(readSDKManifest));
  const errors: string[] = [];
  if (!isSemver(client.version)) errors.push(`Invalid client version: ${client.version}`);
  if (client.version !== react.version)
    errors.push(`SDK versions differ: client=${client.version}, react=${react.version}`);
  if (react.dependencies?.['@qbflex/client'] !== `workspace:*`)
    errors.push('The workspace React package must depend on @qbflex/client through workspace:*');
  for (const [index, manifest] of [client, react].entries()) {
    const expectedName = publicSDKPackages[index]!.name;
    if (manifest.name !== expectedName)
      errors.push(`SDK package name differs: expected=${expectedName}, actual=${manifest.name}`);
    if (manifest.private === true) errors.push(`${manifest.name} is marked private`);
    if (manifest.publishConfig?.access !== 'public')
      errors.push(`${manifest.name} must set publishConfig.access to public`);
    if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org/')
      errors.push(`${manifest.name} must explicitly target the npmjs registry`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return client.version as string;
}

async function setVersion(version: string) {
  if (!isSemver(version))
    throw new Error(`Expected an exact semantic version, received: ${version}`);
  for (const pkg of publicSDKPackages) {
    const path = `packages/${pkg.folder}/package.json`;
    const manifest = readManifest(path);
    manifest.version = version;
    writeManifest(path, manifest);
  }
  console.log(`Set both public SDK packages to ${version}.`);
  console.log(
    'Review the diff, add release notes, run the release check, then commit the version change.',
  );
}

function assertCleanCheckout() {
  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Unable to inspect the Git checkout');
  if (status.stdout.trim())
    throw new Error('Publishing requires a clean checkout. Commit or stash all changes first.');
}

function assertNpmScopeAccess() {
  const identity = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
  if (identity.status !== 0)
    throw new Error('npm authentication is required. Run npm login, then retry the release.');

  const account = identity.stdout.trim();
  const scope = publicSDKPackages[0]?.name.match(/^@([^/]+)\//)?.[1];
  if (!scope) throw new Error('Unable to determine the npm scope from the SDK package names.');
  if (account === scope) return;

  const organization = spawnSync('npm', ['org', 'ls', scope, '--json'], {
    encoding: 'utf8',
  });
  if (organization.status !== 0) {
    throw new Error(
      `npm scope @${scope} is unavailable to account ${account}. Create the npm organization "${scope}" and grant this account publish access before retrying.`,
    );
  }

  let members: unknown;
  try {
    members = JSON.parse(organization.stdout);
  } catch {
    throw new Error(`npm returned invalid organization metadata for @${scope}.`);
  }
  if (
    !members ||
    typeof members !== 'object' ||
    Array.isArray(members) ||
    !Object.hasOwn(members, account)
  ) {
    throw new Error(
      `npm account ${account} is not a member of @${scope}. Grant it publish access before retrying.`,
    );
  }
}

async function publish(args: string[]) {
  const execute = args.includes('--execute');
  const provenance = args.includes('--provenance');
  const tagIndex = args.indexOf('--tag');
  const requestedTag = tagIndex === -1 ? undefined : args[tagIndex + 1];
  if (tagIndex !== -1 && (!requestedTag || requestedTag.startsWith('--')))
    throw new Error('--tag requires a value');
  if (execute) {
    assertCleanCheckout();
    assertNpmScopeAccess();
  }
  const version = await validateSDKReleaseMetadata();
  const tag = requestedTag ?? defaultNpmTag(version);
  run('bun', ['run', 'sdk:pack']);
  run('bun', ['scripts/sdk-consumer-check.ts']);
  for (const pkg of publicSDKPackages) {
    const manifest = await readSDKManifest(pkg);
    const command = [
      'publish',
      sdkTarballPath(pkg, manifest.version),
      '--access',
      'public',
      '--tag',
      tag,
      ...(provenance ? ['--provenance'] : []),
      ...(!execute ? ['--dry-run'] : []),
    ];
    run('npm', command);
  }
  console.log(
    execute
      ? `Published @qbflex/client and @qbflex/react ${version} with the ${tag} tag.`
      : `Dry run passed for both SDK packages at ${version} with the ${tag} tag. No registry state changed.`,
  );
}

async function main() {
  const [command = 'check', value, ...rest] = process.argv.slice(2);
  if (command === 'version') {
    if (!value) throw new Error('Usage: bun run sdk:version <x.y.z>');
    await setVersion(value);
    return;
  }
  if (command === 'check') {
    const version = await validateSDKReleaseMetadata();
    console.log(`SDK release metadata is consistent at ${version}.`);
    return;
  }
  if (command === 'publish') {
    await publish([value, ...rest].filter((entry): entry is string => Boolean(entry)));
    return;
  }
  throw new Error('Usage: sdk-release.ts <check|version|publish>');
}

if (import.meta.main) await main();
