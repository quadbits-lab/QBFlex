import ts from 'typescript';
import { routes } from '@qb-flex/contracts';
const source = ts.createSourceFile(
  'service.ts',
  await Bun.file('apps/api/src/service.ts').text(),
  ts.ScriptTarget.Latest,
  true,
);
const implemented = new Set<string>();
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text,
      arg = node.arguments[0];
    if (
      ['get', 'post', 'put', 'patch', 'delete', 'all'].includes(method) &&
      arg &&
      ts.isStringLiteral(arg) &&
      arg.text.startsWith('/') &&
      !arg.text.startsWith('/internal/')
    ) {
      const path = arg.text
        .replace(/:([^/]+)/g, '{$1}')
        .replace(
          /^\/v1\/projects\/\{id\}\/branches\/\{branch\}\//,
          '/v1/projects/{projectId}/branches/{branchId}/',
        );
      implemented.add(`${method === 'all' ? 'GET/POST' : method.toUpperCase()} ${path}`);
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
const declared = new Set(
  routes.filter(([method]) => method !== 'WS').map(([method, path]) => `${method} ${path}`),
);
for (const value of implemented)
  if (!declared.has(value)) throw new Error('Undocumented route: ' + value);
for (const value of declared)
  if (!implemented.has(value)) throw new Error('Contract has no route: ' + value);
console.log(`${declared.size} public route contracts match the implementation.`);
