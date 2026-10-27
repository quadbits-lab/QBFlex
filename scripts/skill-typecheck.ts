import ts from 'typescript';
import { resolve } from 'node:path';
const root = process.cwd(),
  base = '.claude/skills/qbflex-skills/assets/examples';
const program = ts.createProgram(
  [`${base}/react/src/main.tsx`, `${base}/vanilla/src/typecheck.ts`],
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: root,
    paths: {
      '@qbflex/client': ['packages/sdk-js/dist/index.d.ts'],
      '@qbflex/react': ['packages/sdk-react/dist/index.d.ts'],
      'react/jsx-runtime': ['node_modules/@types/react/jsx-runtime.d.ts'],
    },
  },
);
const errors = ts.getPreEmitDiagnostics(program);
if (errors.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
console.log(
  'Skill React and Vanilla consumers compile against emitted SDK and generated Database/RPC declarations.',
);
