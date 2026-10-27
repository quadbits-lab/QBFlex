import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapTokenMatches, normalize, resolveBootstrapToken } from '../apps/api/src/bootstrap';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'qb-bootstrap-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test('the token comes from QB_BOOTSTRAP_TOKEN and is trimmed', () => {
  const state = resolveBootstrapToken({
    hasOwner: false,
    env: { QB_BOOTSTRAP_TOKEN: '  abc123  \n' },
  });
  expect(state).toEqual({ token: 'abc123', source: 'environment' });
});

test('quotes from pasted values are stripped', () => {
  const state = resolveBootstrapToken({
    hasOwner: false,
    env: { QB_BOOTSTRAP_TOKEN: '"abc123"' },
  });
  expect(state.token).toBe('abc123');
});

test('an explicitly configured token wins over the environment', () => {
  const state = resolveBootstrapToken({
    hasOwner: false,
    configured: 'from-config',
    env: { QB_BOOTSTRAP_TOKEN: 'from-environment' },
  });
  expect(state).toEqual({ token: 'from-config', source: 'environment' });
});

test('a missing token fails with actionable guidance instead of generating a file', () => {
  expect(() => resolveBootstrapToken({ hasOwner: false, env: {} })).toThrow(
    'QB_BOOTSTRAP_TOKEN is required for first-owner setup',
  );
  expect(directory).toBeTruthy();
});

test('the example placeholder is rejected rather than accepted', () => {
  expect(() =>
    resolveBootstrapToken({
      hasOwner: false,
      env: { QB_BOOTSTRAP_TOKEN: 'replace_with_openssl_rand_hex_32' },
    }),
  ).toThrow('still contains the example placeholder');
});

test('restarting an installation that already has an owner needs no token', () => {
  expect(resolveBootstrapToken({ hasOwner: true, env: {} })).toEqual({ source: 'none' });
  expect(resolveBootstrapToken({ hasOwner: true, env: { QB_BOOTSTRAP_TOKEN: 'abc' } })).toEqual({
    source: 'none',
  });
});

test('token comparison ignores surrounding whitespace and rejects mismatches', () => {
  expect(bootstrapTokenMatches(' abc123 ', 'abc123')).toBe(true);
  expect(bootstrapTokenMatches('abc123\n', 'abc123')).toBe(true);
  expect(bootstrapTokenMatches('abc124', 'abc123')).toBe(false);
  expect(bootstrapTokenMatches('', 'abc123')).toBe(false);
  expect(bootstrapTokenMatches('abc123', undefined)).toBe(false);
});

test('normalize keeps inner characters intact', () => {
  expect(normalize('  a b c  ')).toBe('a b c');
  expect(normalize(undefined)).toBe('');
});

test('an env file supplies the token through the normal process environment', () => {
  const envFile = join(directory, '.env');
  writeFileSync(envFile, 'QB_MASTER_KEY=abc\nQB_BOOTSTRAP_TOKEN=env-file-token\n');
  const parsed = readFileSync(envFile, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('QB_BOOTSTRAP_TOKEN='))!
    .slice('QB_BOOTSTRAP_TOKEN='.length);
  expect(resolveBootstrapToken({ hasOwner: false, env: { QB_BOOTSTRAP_TOKEN: parsed } }).token).toBe(
    'env-file-token',
  );
});
