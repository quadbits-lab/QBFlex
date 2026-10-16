#!/usr/bin/env bun
// Source-based reference generation. Run from a QB Flex source checkout with Bun.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { checkPackage, filesIn, sha256 } from './check-package.mjs';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1]! : fallback;
const source = resolve(value('--source-root', process.cwd()));
const target = resolve(value('--skill-dir', join(import.meta.dir, '..')));
const check = args.includes('--check');
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
if (manifest.name !== 'qb-flex' || manifest.version !== '0.1.0')
  throw new Error(
    'Requires verified QB Flex 0.1.0 source; refresh compatibility only after verification',
  );
const run = async (command: string[]) => {
  const child = Bun.spawn(command, {
    cwd: source,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, COLUMNS: '100' },
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(`Reference command failed: ${command.slice(0, 3).join(' ')}\n${err}`);
  return out;
};
if (!check) await run(['bun', 'scripts/sdk-build.ts']);
const load = (file: string) => import(pathToFileURL(join(source, file)).href);
const { routes, capabilities } = await load('packages/contracts/src/index.ts');
const ts = (await load('node_modules/typescript/lib/typescript.js')).default;
const put = (name: string, content: string | Uint8Array) => {
  const file = join(target, name);
  mkdirSync(dirname(file), { recursive: true });
  if (check) {
    let existing;
    try {
      existing = readFileSync(file);
    } catch {
      throw new Error(`Missing generated artifact: ${name}`);
    }
    if (!existing.equals(Buffer.from(content)))
      throw new Error(`Stale generated artifact: ${name}; run skill:refresh`);
  } else writeFileSync(file, content);
};
put(
  'references/generated/api.md',
  `# API and capability summary\n\nGenerated from shared QB Flex ${manifest.version} contracts. This is the route registry; request shapes and identity requirements remain defined by source and the curated references.\n\n| Method | Route | Purpose |\n| --- | --- | --- |\n${routes.map(([method, path, title]: string[]) => `| ${method} | \`${path}\` | ${title} |`).join('\n')}\n\n## Availability\n\n${Object.entries(
    capabilities,
  )
    .map(([name, status]) => `- **${name}:** ${status}`)
    .join('\n')}\n`,
);
put(
  'references/generated/sdk.md',
  `# SDK export declarations\n\nGenerated from the actual 0.1.0 SDK declaration artifacts. Integer types preserve precision; omitted exposure columns are absent from generated database types.\n\n${['sdk-js', 'sdk-react'].map((folder) => `## ${folder === 'sdk-js' ? '@qb-flex/client' : '@qb-flex/react'}\n\n\`\`\`ts\n${readFileSync(join(source, 'packages', folder, 'dist/index.d.ts'), 'utf8')}\n\`\`\`\n`).join('\n')}`,
);
const cli = readFileSync(join(source, 'apps/cli/src/index.ts'), 'utf8');
const groups = new Map<string, string>([['program', '']]);
for (const m of cli.matchAll(/const (\w+) = program\.command\('([^']+)'\);/g))
  groups.set(m[1]!, m[2]!);
const commands = [[] as string[]];
for (const m of cli.matchAll(/(\w+)\s*\.command\('([^']+)'\)/g)) {
  if (!groups.has(m[1]!)) throw new Error('Unrecognized CLI command owner; update extraction');
  commands.push([groups.get(m[1]!)!, m[2]!].filter(Boolean));
}
const help = [];
for (const command of commands)
  help.push(
    `## qb ${command.join(' ') || '--help'}\n\n\`\`\`text\n${(await run(['bun', 'apps/cli/src/index.ts', ...command, '--help'])).trim()}\n\`\`\``,
  );
put(
  'references/generated/cli.md',
  `# CLI command reference\n\nGenerated from real Commander help for each source-declared command. Source checkout invocation is \`bun run qb\`. Help extraction does not execute command actions.\n\n${help.join('\n\n')}\n`,
);
const testFiles = filesIn(join(source, 'tests')).filter((file: string) => /\.tsx?$/.test(file));
const evidence = [];
for (const file of testFiles) {
  const path = join(source, 'tests', file),
    content = readFileSync(path, 'utf8');
  const tree = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const titles: string[] = [];
  const visit = (node: any) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree).startsWith('test') &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      titles.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  evidence.push(
    `## tests/${file}\n\nSHA-256: \`${sha256(readFileSync(path))}\`\n\n${titles.length ? titles.map((title) => `- ${title}`).join('\n') : 'Shared test fixture; scenario names are in its consuming test files.'}`,
  );
}
put(
  'references/generated/tests.md',
  `# Executable test source evidence\n\nGenerated descriptions and hashes identify supporting tests in the QB Flex source checkout. They do not imply that a test has passed on the reader's deployment. Curated scenario mapping is in the validation reference.\n\n${evidence.join('\n\n')}\n`,
);
const directory = mkdtempSync(join(tmpdir(), 'qb-skill-schema-'));
try {
  const { openDatabase } = await load('packages/database/src/index.ts');
  const { initializeBranch, expose, registerRPC } = await load('packages/schema/src/index.ts');
  const { BranchEngine } = await load('packages/database/src/engine.ts');
  const db = openDatabase(join(directory, 'main.pglite'));
  try {
    await initializeBranch(db);
    const engine = await new BranchEngine(db, 'skill-types').initialize();
    const prerequisites = JSON.parse(
      readFileSync(join(target, 'assets/examples/prerequisites.json'), 'utf8'),
    );
    await engine.migration(
      prerequisites.migrationId,
      readFileSync(join(target, 'assets/examples/schema.sql'), 'utf8'),
      'skill-types',
    );
    await expose(db, 'tasks', true, prerequisites.exposure.columns);
    await registerRPC(db, prerequisites.rpc);
    const types = await engine.types();
    for (const kind of ['react', 'vanilla'])
      put(`assets/examples/${kind}/src/qb-flex.types.ts`, types);
  } finally {
    await db.close(true);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
put(
  'assets/examples/vanilla/vendor/client.js',
  readFileSync(join(source, 'packages/sdk-js/dist/index.js')),
);
const inputs = [
  'package.json',
  'bun.lock',
  'qb-flex-development-spec.md',
  'scripts/sdk-build.ts',
  'scripts/dev.ts',
  'scripts/skill.ts',
  'scripts/skill-test.ts',
  'scripts/skill-typecheck.ts',
  'scripts/pglite-benchmark.ts',
  ...filesIn(join(source, 'migrations'))
    .filter((file: string) => file.endsWith('.sql'))
    .map((file: string) => 'migrations/' + file),
  'apps/docs/content/database/policies.mdx',
  'apps/docs/content/roadmap/phases.mdx',
  ...readdirSync(join(source, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`),
  ...[
    ...readdirSync(join(source, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/src`),
    'apps/api/src',
    'apps/worker/src',
    'apps/cli/src',
    'tests',
  ].flatMap((folder) =>
    filesIn(join(source, folder))
      .filter(
        (file: string) =>
          !file.split('/').some((p) => ['node_modules', 'dist'].includes(p)) &&
          /\.(tsx?|json)$/.test(file),
      )
      .map((file: string) => folder + '/' + file),
  ),
];
const sources = [...new Set(inputs)]
  .sort()
  .map((path) => ({ path, sha256: sha256(readFileSync(join(source, path))) }));
const payload = {
  formatVersion: 1,
  name: 'qbflex-skills',
  version: '0.1.0',
  productVersion: '0.1.0',
  checksumAlgorithm: 'sha256',
  provenance:
    'Implemented repository sources, emitted SDK declarations and executable tests; design spec is planned-scope context.',
  sources,
  files: Object.fromEntries(
    filesIn(target)
      .filter((file: string) => file !== 'MANIFEST.json')
      .map((file: string) => [file, sha256(readFileSync(join(target, file)))]),
  ),
};
put('MANIFEST.json', JSON.stringify(payload, null, 2) + '\n');
console.log(JSON.stringify({ mode: check ? 'check' : 'refresh', ...checkPackage(target) }));
