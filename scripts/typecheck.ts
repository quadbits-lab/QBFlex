export {};
for (const project of ['tsconfig.json', 'apps/studio/tsconfig.json', 'apps/docs/tsconfig.json']) {
  const proc = Bun.spawn(['bun', 'x', 'tsc', '--noEmit', '--project', project], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (await proc.exited) process.exit(1);
}
