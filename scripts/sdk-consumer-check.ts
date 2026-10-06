import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { fixture } from '../tests/helpers';
const directory = mkdtempSync(join(tmpdir(), 'qb-sdk-consumer-')),
  f = await fixture();
try {
  const manifest = await Bun.file('package.json').json();
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@qb-flex/client': 'file:' + resolve('dist/packages/qb-flex-client-0.1.0.tgz'),
        '@qb-flex/react': 'file:' + resolve('dist/packages/qb-flex-react-0.1.0.tgz'),
        react: manifest.dependencies.react,
        'react-dom': manifest.dependencies['react-dom'],
      },
    }),
  );
  const installation = Bun.spawn(
    ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const outputs = await Promise.all([
    new Response(installation.stdout).text(),
    new Response(installation.stderr).text(),
    installation.exited,
  ]);
  if (outputs[2]) throw new Error('Packaged SDK install failed: ' + outputs[1]);
  const project = await f.project('artifact-consumer');
  writeFileSync(
    join(directory, 'consumer.ts'),
    `import {createClient} from '@qb-flex/client';import {useQBQuery} from '@qb-flex/react';interface DB{tasks:{Row:{id:string;title:string};Insert:{title:string};Update:{title?:string}}}const qb=createClient<DB>({url:'http://localhost:7612',projectId:'p',publishableKey:'k'});qb.from('tasks').insert({title:'Typed'});function component(){return useQBQuery({queryKey:['tasks'],queryFn:()=>qb.from('tasks').select(['title']).execute()});}
// @ts-expect-error Invalid exposed table
qb.from('reserved');
// @ts-expect-error Required insert field
qb.from('tasks').insert({});
`,
  );
  const program = ts.createProgram([join(directory, 'consumer.ts')], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => directory,
        getNewLine: () => '\n',
      }),
    );
  writeFileSync(
    join(directory, 'consumer.js'),
    `import {createClient} from '@qb-flex/client';import {QBProvider,useQBAuth} from '@qb-flex/react';import {createElement} from 'react';import {renderToString} from 'react-dom/server';
const qb=createClient(${JSON.stringify({ url: f.url, projectId: project.id, branch: project.branchId, publishableKey: project.key })});
function Status(){return createElement('span',null,useQBAuth().user?.id??'anonymous');}
if(!renderToString(createElement(QBProvider,{client:qb},createElement(Status))).includes('anonymous'))throw new Error('Packaged SSR failed');
const session=await qb.auth.signUp({name:'Artifact',email:'artifact@example.com',password:'artifact-password-12345'});
let joined=false,events=[];const channel=qb.channel({table:'tasks',onStatus:status=>{joined=status==='connected';},onEvent:event=>events.push(event)}).subscribe();
for(let i=0;i<50&&!joined;i++)await Bun.sleep(20);if(!joined)throw new Error('Artifact realtime did not join');
const inserted=await qb.from('tasks').insert({title:'Artifact task',owner_id:session.user.id},{idempotencyKey:crypto.randomUUID()});
for(let i=0;i<50&&!events.some(event=>event.payload.title==='Artifact task');i++)await Bun.sleep(20);if(!events.length)throw new Error('Artifact realtime event missing');
const rows=await qb.from('tasks').eq('id',inserted.data[0].id).execute();if(rows.data.length!==1)throw new Error('Artifact CRUD failed');
await qb.from('tasks').delete(inserted.data[0].id);channel.unsubscribe();await qb.auth.signOut();qb.dispose();console.log('Packaged ESM imports, declarations, SSR, authentication, CRUD and realtime passed.');`,
  );
  const consumer = Bun.spawn(['bun', 'consumer.js'], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const result = await Promise.all([
    new Response(consumer.stdout).text(),
    new Response(consumer.stderr).text(),
    consumer.exited,
  ]);
  if (result[2]) throw new Error('Packaged SDK consumer failed: ' + result[1]);
  console.log(result[0].trim());
  project.client.dispose();
} finally {
  await f.close();
  rmSync(directory, { recursive: true, force: true });
}
