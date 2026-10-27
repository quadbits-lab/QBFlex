import { expect, test } from 'bun:test';
import { bootstrapHint, generatedTokenPath, nativeTokenPath } from '../apps/studio/src/bootstrap-hint';

test('each token source points at the place the API actually reads', () => {
  const environment = bootstrapHint('environment');
  expect(environment.message).toContain('QB_BOOTSTRAP_TOKEN');
  expect(environment.commands[0]).toContain('printenv QB_BOOTSTRAP_TOKEN');
  // The environment must be the recommendation; the file path would be wrong here.
  expect(environment.message).not.toContain(generatedTokenPath);

  const secretFile = bootstrapHint('environment-file');
  expect(secretFile.message).toContain('QB_BOOTSTRAP_TOKEN_FILE');
  expect(secretFile.commands).toHaveLength(0);

  const file = bootstrapHint('file');
  expect(file.commands[0]).toContain(generatedTokenPath);
  expect(file.commands[1]).toContain(nativeTokenPath);
});

test('an older API without tokenSource still gets usable guidance', () => {
  for (const source of [undefined, 'none'] as const) {
    const hint = bootstrapHint(source);
    expect(hint.message).toContain('QB_BOOTSTRAP_TOKEN');
    expect(hint.commands).toHaveLength(2);
  }
});

test('hints never include a token value placeholder that could be mistaken for a real secret', () => {
  for (const source of ['environment', 'environment-file', 'file', 'none', undefined] as const) {
    const hint = bootstrapHint(source);
    expect(hint.message).not.toMatch(/[0-9a-f]{32}/);
    expect(hint.commands.join(' ')).not.toMatch(/[0-9a-f]{32}/);
  }
});
