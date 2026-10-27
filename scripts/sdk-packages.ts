import { resolve } from 'node:path';

export const publicSDKPackages = [
  { folder: 'sdk-js', artifact: 'client', name: '@qb-flex/client' },
  { folder: 'sdk-react', artifact: 'react', name: '@qb-flex/react' },
] as const;

export type PublicSDKPackage = (typeof publicSDKPackages)[number];

export async function readSDKManifest(pkg: PublicSDKPackage) {
  return (await Bun.file(`packages/${pkg.folder}/package.json`).json()) as Record<string, any>;
}

export function sdkTarballPath(pkg: PublicSDKPackage, version: string) {
  return resolve(`dist/packages/qb-flex-${pkg.artifact}-${version}.tgz`);
}

export function sdkPeerRange(version: string) {
  return `^${version}`;
}

export function isSemver(version: string) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    version,
  );
}

export function defaultNpmTag(version: string) {
  return version.includes('-') ? 'next' : 'latest';
}
