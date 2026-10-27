import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuration } from '../packages/database/src/index';

const keys = [
  'NODE_ENV',
  'QB_DATA_DIR',
  'QB_MASTER_KEY',
  'QB_PUBLIC_URL',
  'QB_ALLOW_INSECURE_HTTP',
] as const;
const original: Record<string, string | undefined> = {};
let directory: string;

beforeEach(() => {
  for (const key of keys) original[key] = process.env[key];
  directory = mkdtempSync(join(tmpdir(), 'qb-config-'));
  process.env.QB_DATA_DIR = directory;
  process.env.QB_MASTER_KEY = 'a'.repeat(64);
  delete process.env.QB_ALLOW_INSECURE_HTTP;
});

afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  rmSync(directory, { recursive: true, force: true });
});

test('production requires HTTPS unless loopback staging explicitly opts in', () => {
  process.env.NODE_ENV = 'production';
  process.env.QB_PUBLIC_URL = 'http://localhost:7612';
  expect(() => configuration()).toThrow('Production requires HTTPS QB_PUBLIC_URL');

  process.env.QB_ALLOW_INSECURE_HTTP = 'true';
  expect(configuration().publicURL).toBe('http://localhost:7612');

  process.env.QB_PUBLIC_URL = 'http://127.0.0.1:7612';
  expect(configuration().publicURL).toBe('http://127.0.0.1:7612');

  process.env.QB_PUBLIC_URL = 'http://api.example.com';
  expect(() => configuration()).toThrow('Production requires HTTPS QB_PUBLIC_URL');

  process.env.QB_PUBLIC_URL = 'https://api.example.com';
  delete process.env.QB_ALLOW_INSECURE_HTTP;
  expect(configuration().publicURL).toBe('https://api.example.com');
});

test('development keeps HTTP localhost defaults', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.QB_PUBLIC_URL;
  expect(configuration().publicURL).toBe('http://localhost:7612');
});
