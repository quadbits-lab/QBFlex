import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  defaultNpmTag,
  isSemver,
  publicSDKPackages,
  readSDKManifest,
  sdkPeerRange,
  sdkTarballPath,
} from '../scripts/sdk-packages';
import { validateSDKReleaseMetadata } from '../scripts/sdk-release';

test('SDK release metadata stays synchronized and explicitly public', async () => {
  expect(await validateSDKReleaseMetadata()).toBe('0.1.0');
  const manifests = await Promise.all(publicSDKPackages.map(readSDKManifest));
  expect(manifests.map((manifest) => manifest.version)).toEqual(['0.1.0', '0.1.0']);
  expect(manifests.every((manifest) => manifest.publishConfig.access === 'public')).toBe(true);
});

test('SDK release helpers handle stable and prerelease versions without fixed artifact names', () => {
  expect(isSemver('0.2.0')).toBe(true);
  expect(isSemver('1.0.0-rc.1')).toBe(true);
  expect(isSemver('v1.0.0')).toBe(false);
  expect(defaultNpmTag('0.2.0')).toBe('latest');
  expect(defaultNpmTag('1.0.0-rc.1')).toBe('next');
  expect(sdkPeerRange('0.2.0')).toBe('^0.2.0');
  expect(sdkTarballPath(publicSDKPackages[0], '0.2.0')).toEndWith(
    '/dist/packages/qb-flex-client-0.2.0.tgz',
  );
});

test('emitted React declarations are self-contained apart from declared peers', () => {
  const declarations = readFileSync('packages/sdk-react/dist/index.d.ts', 'utf8');
  expect(declarations).not.toContain('@qb-flex/contracts');
  expect(declarations).toContain('./contracts/index');
});
