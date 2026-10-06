export {};
for (const args of [
  ['bun', 'run', 'sdk:build'],
  ['bun', 'run', 'docs:generate'],
  ...['apps/studio', 'apps/docs', 'examples/react', 'examples/vanilla'].map((app) => [
    'bun',
    'run',
    '--cwd',
    app,
    'build',
  ]),
]) {
  const process = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
  if (await process.exited) throw new Error(`Build failed: ${args.join(' ')}`);
}
