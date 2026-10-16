import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { openDatabase } from '@qb-flex/database';
import { initializeBranch, expose, registerRPC } from '@qb-flex/schema';
import { BranchEngine } from '../packages/database/src/engine';
const directory = mkdtempSync(join(tmpdir(), 'qb-types-'));
const db = openDatabase(join(directory, 'main.pglite'));
try {
  await initializeBranch(db);
  const engine = await new BranchEngine(db, 'test').initialize();
  await engine.migration(
    '001',
    "CREATE TABLE tasks(id TEXT PRIMARY KEY NOT NULL DEFAULT(replace(gen_random_uuid()::text,'-','')),owner_id TEXT NOT NULL,title TEXT NOT NULL,completed BIGINT NOT NULL DEFAULT 0);",
    'test',
  );
  await expose(db, 'tasks', true, ['id', 'owner_id', 'title', 'completed']);
  await registerRPC(db, {
    name: 'create_task',
    table: 'tasks',
    kind: 'insert',
    args: { title: 'string' },
    values: { title: { arg: 'title' }, owner_id: { claim: 'sub' } },
  });
  writeFileSync(join(directory, 'qb-flex.types.ts'), await engine.types());
  writeFileSync(
    join(directory, 'consumer.tsx'),
    `import {createClient} from '@qb-flex/client';import {useQBQuery,useQBMutation,QBProvider,useQBClient} from '@qb-flex/react';import type {Database,RPC} from './qb-flex.types';
const client=createClient<Database,RPC>({url:'http://localhost:7612',projectId:'p',publishableKey:'k'});
client.from('tasks').select(['title']).eq('completed',0);client.from('tasks').insert({title:'Typed',owner_id:'user'});
// @ts-expect-error invalid table
client.from('secrets');
// @ts-expect-error invalid column
client.from('tasks').select(['password']);
// @ts-expect-error missing required owner
client.from('tasks').insert({title:'Missing owner'});
// @ts-expect-error invalid update column
client.from('tasks').update('id',{token:'secret'});
const query=useQBQuery({queryKey:['tasks'],queryFn:()=>client.from('tasks').select(['title']).execute()});
if(query.data){const title:string=query.data.data[0].title;
// @ts-expect-error projection excludes owner
query.data.data[0].owner_id;}
const mutation=useQBMutation({mutationFn:(_:unknown,title:string)=>client.from('tasks').insert({title,owner_id:'user'})});mutation.mutate('Valid');
// @ts-expect-error variable type is retained
mutation.mutate(123);
const provider=<QBProvider client={client}><span>Typed provider</span></QBProvider>;
function typedRPC(){const configured=useQBClient<Database,RPC>();configured.rpc('create_task',{title:'Typed'});
// @ts-expect-error configured hook retains RPC names
configured.rpc('unknown',{});}
client.rpc('create_task',{title:'Typed'});
// @ts-expect-error unregistered RPC
client.rpc('raw_sql',{});
// @ts-expect-error wrong RPC arguments
client.rpc('create_task',{sql:'DROP TABLE tasks'});
const rpc:RPC['create_task']['Args']={title:'Typed'};
// @ts-expect-error RPC argument names
const invalid:RPC['create_task']['Args']={sql:'DROP TABLE tasks'};
`,
  );
  const program = ts.createProgram([join(directory, 'consumer.tsx')], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: process.cwd(),
    paths: {
      'react/jsx-runtime': ['node_modules/@types/react/jsx-runtime.d.ts'],
      '@qb-flex/contracts': ['packages/contracts/src/index.ts'],
      '@qb-flex/client': ['packages/sdk-js/src/index.ts'],
      '@qb-flex/react': ['packages/sdk-react/src/index.tsx'],
    },
  });
  const errors = ts.getPreEmitDiagnostics(program);
  if (errors.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: (p) => p,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }),
    );
  console.log('Generated row/insert/update/RPC types and React inference checked.');
} finally {
  await db.close(true);
  rmSync(directory, { recursive: true, force: true });
}
