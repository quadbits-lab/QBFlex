import { writeFileSync, mkdirSync } from 'node:fs';
import ts from 'typescript';
import { Glob } from 'bun';
const files: string[] = [];
mkdirSync('.cache/doc-examples', { recursive: true });
// Fences are repository-owned source artifacts. Declarations model tutorial prerequisites, never SDK methods.
const context = `import {createClient} from '@qbflex/client';
import {QBProvider,useQBAuth,useQBQuery,useQBMutation,useQBRealtime,useQBStorage} from '@qbflex/react';
interface Database {tasks:{Row:{id:string;owner_id:string;title:string;completed:number;revision:number};Insert:{id?:string;owner_id:string;title:string;completed?:number};Update:{title?:string;completed?:number}}}
const client=createClient<Database>({url:'http://localhost:7612',projectId:'example',publishableKey:'example'});
const qb=client;declare const auth:ReturnType<typeof useQBAuth>;const task={id:'example',revision:1};const taskId='example';const title='example';const email='example@example.com',password='example-password',name='Example';const row={title,owner_id:'example'};
const accountLabel=document.createElement('p'),list=document.createElement('ul'),errorMessage=document.createElement('p');
const bucketId='example',objectId='example',file=new Blob(),key='example';const controller=new AbortController();const tasks={data:undefined as undefined|{meta:{consistencyToken:string}}};const result={meta:{cursor:'example'}};
const connectionLabel=document.createElement('p'),fileInput=document.createElement('input'),downloadLink=document.createElement('a');const channel=qb.channel({table:'tasks',onEvent:()=>{}}),stopAuth=()=>{};function SignIn(){return null;}
const reloadTasks=()=>{};const refreshTasks=()=>{};function Tasks(){return null;}
`;
for (const path of new Glob('apps/docs/content/**/*.mdx').scanSync('.')) {
  const source = await Bun.file(path).text();
  let index = 0;
  for (const match of source.matchAll(/```(tsx|ts|js)\n([\s\S]*?)```/g)) {
    index++;
    if (path.includes('/reference/')) continue;
    const code = match[2]!;
    const imports: string[] = [];
    const definitions: string[] = [];
    const parsed = ts.createSourceFile(
      'example.tsx',
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    for (const statement of parsed.statements) {
      if (ts.isImportDeclaration(statement)) {
        // Imports of generated types resolve to the prerequisite declarations above.
        if (
          !statement.moduleSpecifier.getText().includes('qb-flex.types') &&
          !statement.moduleSpecifier.getText().includes('@qb-flex/') &&
          !statement.moduleSpecifier.getText().includes('@qbflex/')
        )
          imports.push(statement.getText());
      } else definitions.push(statement.getText().replace(/^export\s+/, ''));
    }
    const scaffold = context;
    const output =
      '.cache/doc-examples/' + path.replaceAll('/', '_').replace('.mdx', `_${index}.tsx`);
    writeFileSync(
      output,
      imports.join('\n') +
        '\n' +
        scaffold +
        '\nasync function tutorial(){\n' +
        definitions.join('\n') +
        '\n}\n',
    );
    files.push(output);
  }
}
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  baseUrl: '.',
  paths: {
    '@qb-flex/contracts': ['packages/contracts/src/index.ts'],
    '@qbflex/client': ['packages/sdk-js/src/index.ts'],
    '@qbflex/react': ['packages/sdk-react/src/index.tsx'],
  },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
  process.exit(1);
}
console.log(`${files.length} tutorial code artifacts typechecked against the SDK.`);
