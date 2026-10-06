import { cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
await import('./sdk-build');
for (const [folder, name] of [
  ['sdk-js', 'client'],
  ['sdk-react', 'react'],
]) {
  const dir = `.cache/pack/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(`packages/${folder}/dist`, `${dir}/dist`, { recursive: true });
  cpSync(`packages/${folder}/README.md`, `${dir}/README.md`);
  const manifest = await Bun.file(`packages/${folder}/package.json`).json();
  manifest.exports = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } };
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
    manifest.peerDependencies = { ...manifest.peerDependencies, '@qb-flex/client': '^0.1.0' };
  writeFileSync(`${dir}/package.json`, JSON.stringify(manifest, null, 2));
  const result = Bun.spawnSync(
    ['bun', 'pm', 'pack', '--destination', process.cwd() + '/dist/packages'],
    { cwd: dir, stdout: 'inherit', stderr: 'inherit' },
  );
  if (result.exitCode) throw new Error('SDK packaging failed');
}
