import { cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { publicSDKPackages, readSDKManifest, sdkPeerRange } from './sdk-packages';
await import('./sdk-build');
for (const sdkPackage of publicSDKPackages) {
  const { folder, artifact } = sdkPackage;
  const dir = `.cache/pack/${artifact}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(`packages/${folder}/dist`, `${dir}/dist`, { recursive: true });
  cpSync(`packages/${folder}/README.md`, `${dir}/README.md`);
  const manifest = await readSDKManifest(sdkPackage);
  manifest.exports = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } };
  manifest.types = './dist/index.d.ts';
  manifest.module = './dist/index.js';
  delete manifest.private;
  manifest.dependencies =
    folder === 'sdk-react'
      ? {
          '@tanstack/react-query': (await Bun.file('package.json').json()).dependencies[
            '@tanstack/react-query'
          ],
        }
      : {};
  if (folder === 'sdk-react')
    manifest.peerDependencies = {
      ...manifest.peerDependencies,
      '@qbflex/client': sdkPeerRange(manifest.version),
    };
  writeFileSync(`${dir}/package.json`, JSON.stringify(manifest, null, 2));
  const result = Bun.spawnSync(
    ['bun', 'pm', 'pack', '--destination', process.cwd() + '/dist/packages'],
    { cwd: dir, stdout: 'inherit', stderr: 'inherit' },
  );
  if (result.exitCode) throw new Error('SDK packaging failed');
}
