import { expect, test } from 'bun:test';
import { bootstrapHint, envVariable } from '../apps/studio/src/bootstrap-hint';

test('the hint always names the environment variable that holds the token', () => {
  for (const source of ['environment', undefined] as const) {
    const hint = bootstrapHint(source);
    expect(hint.message).toContain(envVariable);
    expect(hint.commands[0]).toContain(envVariable);
  }
});

test('a completed installation says the token is no longer needed', () => {
  const hint = bootstrapHint('none');
  expect(hint.message).toContain('already complete');
  expect(hint.commands).toHaveLength(0);
});

test('no hint mentions a token file path, because the token lives only in the environment', () => {
  for (const source of ['environment', 'none', undefined] as const) {
    const hint = bootstrapHint(source);
    const text = hint.message + ' ' + hint.commands.join(' ');
    expect(text).not.toContain('bootstrap.token');
    expect(text).not.toContain('QB_BOOTSTRAP_TOKEN_FILE');
  }
});

test('hints never contain a value that could be mistaken for the real secret', () => {
  for (const source of ['environment', 'none', undefined] as const) {
    const hint = bootstrapHint(source);
    expect(hint.message).not.toMatch(/[0-9a-f]{32}/);
    expect(hint.commands.join(' ')).not.toMatch(/[0-9a-f]{32}/);
  }
});
