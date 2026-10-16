import { expect, test } from 'bun:test';
import {
  publicAddress,
  webhookURL,
  resolveDestination,
  parseInternalAllowlist,
  deliverWebhook,
} from '../apps/worker/src/webhook-delivery';
import { createServer } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('webhook URLs reject unsafe schemes, credentials, ambiguous syntax and private/special IPv4/IPv6', async () => {
  for (const value of [
    'http://example.com',
    'file:///tmp/file',
    'gopher://example.com',
    'https://u:p@example.com',
    'https://example.com#fragment',
    'https://example.com?secret=x',
    'https://example.com\\@127.0.0.1',
    'https://example.com\n',
  ])
    expect(() => webhookURL(value)).toThrow();
  for (const address of [
    '0.0.0.0',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.2.3',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '224.0.0.1',
    '198.18.1.1',
    '192.0.2.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    '2002:7f00:1::',
    '64:ff9b::7f00:1',
  ]) {
    expect(publicAddress(address)).toBe(false);
    await expect(
      resolveDestination(webhookURL('https://receiver.example/events'), {}, async () => [address]),
    ).rejects.toMatchObject({ code: 'DESTINATION_DENIED' });
  }
  expect(publicAddress('8.8.8.8')).toBe(true);
  expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  for (const value of [
    'https://2130706433',
    'https://0x7f000001',
    'https://0177.0.0.1',
    'https://[::ffff:127.0.0.1]',
  ])
    await expect(resolveDestination(webhookURL(value))).rejects.toMatchObject({
      code: 'DESTINATION_DENIED',
    });
});

test('all DNS answers are screened on every dispatch and only a validated address is selected', async () => {
  const url = webhookURL('https://receiver.example/events');
  await expect(
    resolveDestination(url, {}, async () => ['8.8.8.8', '10.0.0.1']),
  ).rejects.toMatchObject({ code: 'DESTINATION_DENIED' });
  let lookups = 0;
  const resolve = async () => (++lookups === 1 ? ['8.8.8.8'] : ['127.0.0.1']);
  expect(await resolveDestination(url, {}, resolve)).toEqual({ address: '8.8.8.8', family: 4 });
  await expect(resolveDestination(url, {}, resolve)).rejects.toMatchObject({
    code: 'DESTINATION_DENIED',
  });
  const allow = parseInternalAllowlist('{"https://internal.example:8443":["10.0.0.2"]}');
  expect(
    await resolveDestination(webhookURL('https://internal.example:8443/hook'), allow, async () => {
      throw new Error('must not resolve');
    }),
  ).toEqual({ address: '10.0.0.2', family: 4 });
  await expect(
    resolveDestination(webhookURL('https://internal.example/hook'), allow, async () => [
      '10.0.0.2',
    ]),
  ).rejects.toThrow();
  for (const raw of [
    '[]',
    '{"*":["10.0.0.1"]}',
    '{"https://internal.example/path":["10.0.0.1"]}',
    '{"https://internal.example":["169.254.169.254"]}',
    '{"https://internal.example":["::ffff:169.254.169.254"]}',
    '{"https://internal.example":["fd00:ec2::254"]}',
  ])
    expect(() => parseInternalAllowlist(raw)).toThrow();
});

test('delivery rejects prohibited destinations and cancellation before issuing HTTPS requests', async () => {
  const delivery = {
    skipped: false as const,
    url: 'https://receiver.example',
    body: '{}',
    headers: {},
  };
  expect(await deliverWebhook(delivery, { resolve: async () => ['127.0.0.1'] })).toEqual({
    success: false,
    code: 'DESTINATION_DENIED',
  });
  const abort = new AbortController();
  abort.abort();
  expect(
    await deliverWebhook(delivery, { signal: abort.signal, resolve: async () => ['8.8.8.8'] }),
  ).toEqual({ success: false, retryable: true, code: 'DELIVERY_TIMEOUT' });
});

test.skipIf(!Bun.which('openssl'))(
  'real HTTPS uses the fixed address, verifies original TLS hostname, does not forward secrets or follow redirects',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qb-webhook-tls-'));
    const cert = join(directory, 'cert.pem'),
      key = join(directory, 'key.pem');
    let server: ReturnType<typeof createServer> | undefined;
    try {
      const openssl = Bun.spawn(
        [
          'openssl',
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-keyout',
          key,
          '-out',
          cert,
          '-subj',
          '/CN=receiver.test',
          '-addext',
          'subjectAltName=DNS:receiver.test',
          '-addext',
          'basicConstraints=critical,CA:TRUE',
        ],
        { stdout: 'ignore', stderr: 'pipe' },
      );
      expect(await openssl.exited).toBe(0);
      const paths: string[] = [],
        headers: Record<string, unknown>[] = [],
        bodies: string[] = [];
      server = createServer(
        { key: readFileSync(key), cert: readFileSync(cert) },
        (request, response) => {
          paths.push(request.url!);
          headers.push(request.headers);
          let body = '';
          request.on('data', (chunk) => {
            body += chunk;
          });
          request.on('end', () => {
            bodies.push(body);
            response.writeHead(
              request.url === '/redirect' ? 302 : request.url === '/rate-limit' ? 429 : 202,
              { location: '/must-not-follow' },
            );
            response.end('provider-secret-must-not-escape');
          });
        },
      );
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      const invoke = async (host: string, path: string) => {
        const origin = `https://${host}:${port}`;
        const child = Bun.spawn(
          [process.execPath, 'tests/fixtures-webhook-delivery.ts', origin + path],
          {
            env: {
              ...process.env,
              NODE_EXTRA_CA_CERTS: cert,
              QB_WEBHOOK_INTERNAL_ALLOWLIST: JSON.stringify({ [origin]: ['127.0.0.1'] }),
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const stdout = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        return JSON.parse(stdout);
      };
      expect(await invoke('receiver.test', '/accept')).toEqual({
        success: true,
        code: 'PROVIDER_ACCEPTED',
      });
      expect(await invoke('receiver.test', '/redirect')).toEqual({
        success: false,
        code: 'REDIRECT_DENIED',
      });
      expect(await invoke('receiver.test', '/rate-limit')).toEqual({
        success: false,
        retryable: true,
        code: 'PROVIDER_RATE_LIMIT',
      });
      expect(await invoke('wrong-hostname.test', '/accept')).toEqual({
        success: false,
        retryable: true,
        code: 'DELIVERY_UNAVAILABLE',
      });
      expect(paths).toEqual(['/accept', '/redirect', '/rate-limit']);
      expect(bodies).toEqual(['{"exact":"body"}', '{"exact":"body"}', '{"exact":"body"}']);
      expect(headers[0]!.host).toBe(`receiver.test:${port}`);
      expect(headers[0]!.authorization).toBeUndefined();
      expect(headers[0]!.cookie).toBeUndefined();
      expect(headers[0]!['x-qb-event-id']).toBe('fixture-event');
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
