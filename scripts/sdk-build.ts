import ts from 'typescript';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const packages = ['sdk-js', 'sdk-react'];
for (const name of packages) {
  mkdirSync(`packages/${name}/dist`, { recursive: true });
  const result = await Bun.build({
    entrypoints: [`packages/${name}/src/index.${name === 'sdk-react' ? 'tsx' : 'ts'}`],
    outdir: `packages/${name}/dist`,
    target: 'browser',
    format: 'esm',
    naming: 'index.js',
    external:
      name === 'sdk-react'
        ? ['react', 'react/jsx-runtime', '@tanstack/react-query', '@qb-flex/client']
        : [],
    sourcemap: 'external',
  });
  if (!result.success) throw new Error(result.logs.join('\n'));
}
const program = ts.createProgram(
  ['packages/sdk-js/src/index.ts', 'packages/sdk-react/src/index.tsx'],
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    declaration: true,
    emitDeclarationOnly: true,
    outDir: '.cache/declarations',
    baseUrl: '.',
    paths: {
      '@qb-flex/contracts': ['packages/contracts/src/index.ts'],
      '@qb-flex/client': ['packages/sdk-js/src/index.ts'],
    },
  },
);
const result = program.emit();
const errors = ts
  .getPreEmitDiagnostics(program)
  .concat(result.diagnostics)
  .filter((d) => d.category === ts.DiagnosticCategory.Error);
if (errors.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
for (const name of packages) {
  const declarations = readFileSync(
    `.cache/declarations/${name}/src/index.d.ts`,
    'utf8',
  ).replaceAll("'@qb-flex/contracts'", "'./contracts'");
  writeFileSync(`packages/${name}/dist/index.d.ts`, declarations);
  writeFileSync(
    `packages/${name}/dist/contracts.d.ts`,
    readFileSync('.cache/declarations/contracts/src/index.d.ts', 'utf8'),
  );
}
mkdirSync('apps/docs/public/sdk', { recursive: true });
writeFileSync('apps/docs/public/sdk/client.js', readFileSync('packages/sdk-js/dist/index.js'));
console.log('Browser ESM bundles and declarations built.');
