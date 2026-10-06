export {};
const command = process.argv[2] ?? 'check';
const directory = '.claude/skills/qbflex-skills';
const args =
  command === 'pack'
    ? ['node', `${directory}/scripts/pack.mjs`, directory, 'dist/skills/qbflex-skills.zip']
    : [
        'bun',
        `${directory}/scripts/refresh.ts`,
        '--source-root',
        '.',
        ...(command === 'check' ? ['--check'] : []),
      ];
if (!['refresh', 'check', 'pack'].includes(command))
  throw new Error('Use skill.ts refresh|check|pack');
if (command === 'pack') {
  const verify = Bun.spawn(['bun', 'scripts/skill.ts', 'check'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (await verify.exited) process.exit(1);
}
const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
process.exitCode = await child.exited;
if (!process.exitCode && command === 'check') {
  const examples = Bun.spawn(['bun', 'scripts/skill-typecheck.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exitCode = await examples.exited;
}
