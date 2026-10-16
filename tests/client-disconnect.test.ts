import { expect, test } from 'bun:test';
import { ignoreClientDisconnectLogs, isClientDisconnect } from '../scripts/client-disconnect';

function abortedRequest() {
  const reset = new Error('aborted');
  Object.assign(reset, { code: 'ECONNRESET' });
  const error = new Error('aborted', { cause: reset });
  Object.assign(error, {
    status: 500,
    statusText: undefined,
    headers: undefined,
    data: undefined,
    body: undefined,
    unhandled: true,
  });
  return error;
}

test('recognizes a client socket reset wrapped as an HTTP error', () => {
  expect(isClientDisconnect(abortedRequest())).toBe(true);
  expect(isClientDisconnect(new Error('database failed'))).toBe(false);
});

test('console.error skips client disconnects and keeps other errors', () => {
  const lines: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    ignoreClientDisconnectLogs();
    console.error(abortedRequest());
    console.error(new Error('real failure'));
    console.error('request failed', abortedRequest());
  } finally {
    console.error = original;
  }
  expect(lines.map((line) => (line[0] instanceof Error ? line[0].message : line[0]))).toEqual([
    'real failure',
    'request failed',
  ]);
});
