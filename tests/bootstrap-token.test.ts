import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapTokenMatches, resolveBootstrapToken } from '../apps/api/src/bootstrap';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'qb-bootstrap-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test('environment token wins and is trimmed', () => {
  const state = resolveBootstrapToken({
    dataDir: directory,
    hasOwner: false,
    env: { NODE_ENV: 'production', QB_BOOTSTRAP_TOKEN: '  abc123  \n' },
  });
  expect(state).toEqual({ token: 'abc123', source: 'environment' });
  expect(existsSync(join(directory, 'bootstrap.token'))).toBe(false);
});

test('production rejects the example placeholder instead of accepting it', () => {
  expect(() =>
    resolveBootstrapToken({
      dataDir: directory,
      hasOwner: false,
      env: { NODE_ENV: 'production', QB_BOOTSTRAP_TOKEN: 'replace_with_openssl_rand_hex_32' },
    }),
  ).toThrow('still contains the example placeholder');
});

test('production without a token fails only while first-owner setup is pending', () => {
  expect(() =>
    resolveBootstrapToken({ dataDir: directory, hasOwner: false, env: { NODE_ENV: 'production' } }),
  ).toThrow('QB_BOOTSTRAP_TOKEN is required for first-owner setup in production');

  // Restarting an installation that already has an owner must not demand the token again.
  expect(
    resolveBootstrapToken({ dataDir: directory, hasOwner: true, env: { NODE_ENV: 'production' } }),
  ).toEqual({ source: 'none' });
});

test('mounted secret file is used when the platform injects secrets as files', () => {
  const file = join(directory, 'bootstrap.secret');
  writeFileSync(file, 'from-mounted-file\n');
  const state = resolveBootstrapToken({
    dataDir: directory,
    hasOwner: false,
    env: { NODE_ENV: 'production', QB_BOOTSTRAP_TOKEN_FILE: file },
  });
  expect(state).toEqual({ token: 'from-mounted-file', source: 'environment-file' });

  writeFileSync(file, '   \n');
  expect(() =>
    resolveBootstrapToken({
      dataDir: directory,
      hasOwner: false,
      env: { NODE_ENV: 'production', QB_BOOTSTRAP_TOKEN_FILE: file },
    }),
  ).toThrow('does not contain a token');
});

test('development generates a stable file token that repeated starts reuse', () => {
  const first = resolveBootstrapToken({ dataDir: directory, hasOwner: false, env: {} });
  expect(first.source).toBe('file');
  expect(first.token).toHaveLength(64);
  expect(readFileSync(join(directory, 'bootstrap.token'), 'utf8').trim()).toBe(first.token!);

  const second = resolveBootstrapToken({ dataDir: directory, hasOwner: false, env: {} });
  expect(second).toEqual(first);
});

test('token comparison ignores surrounding whitespace and rejects mismatches', () => {
  expect(bootstrapTokenMatches(' abc123 ', 'abc123')).toBe(true);
  expect(bootstrapTokenMatches('abc123\n', 'abc123')).toBe(true);
  expect(bootstrapTokenMatches('abc124', 'abc123')).toBe(false);
  expect(bootstrapTokenMatches('', 'abc123')).toBe(false);
  expect(bootstrapTokenMatches('abc123', undefined)).toBe(false);
});
