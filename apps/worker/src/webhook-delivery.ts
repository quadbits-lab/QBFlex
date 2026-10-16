import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { QBError, type WebhookDelivery } from '@qb-flex/contracts';

// Conservative special-purpose ranges: fail closed rather than treating an unknown range as public.
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const metadata = new BlockList();
metadata.addSubnet('169.254.0.0', 16, 'ipv4');
metadata.addAddress('100.100.100.200', 'ipv4');
metadata.addSubnet('::ffff:169.254.0.0', 112, 'ipv6');
metadata.addAddress('::ffff:100.100.100.200', 'ipv6');
metadata.addSubnet('fd00:ec2::', 32, 'ipv6');
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function webhookURL(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value))
    throw new QBError('DESTINATION_DENIED', 'Invalid webhook destination', 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new QBError('DESTINATION_DENIED', 'Invalid webhook destination', 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !url.hostname
  )
    throw new QBError(
      'DESTINATION_DENIED',
      'Use HTTPS without credentials, query strings or fragments',
      400,
    );
  return url;
}
export type InternalAllowlist = Readonly<Record<string, readonly string[]>>;
/** Exact HTTPS origins -> fixed IPs. No wildcard, private DNS lookup or TLS bypass. */
export function parseInternalAllowlist(raw?: string): InternalAllowlist {
  if (!raw) return {};
  try {
    const entries = JSON.parse(raw);
    if (
      !entries ||
      typeof entries !== 'object' ||
      Array.isArray(entries) ||
      Object.keys(entries).length > 20
    )
      throw new Error();
    for (const [origin, addresses] of Object.entries(entries)) {
      const url = webhookURL(origin);
      if (
        url.origin !== origin ||
        !Array.isArray(addresses) ||
        !addresses.length ||
        addresses.length > 8 ||
        addresses.some(
          (ip) =>
            typeof ip !== 'string' ||
            !isIP(ip) ||
            metadata.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4'),
        )
      )
        throw new Error();
    }
    return entries;
  } catch {
    throw new Error(
      'QB_WEBHOOK_INTERNAL_ALLOWLIST requires exact HTTPS origins and fixed non-metadata IP addresses',
    );
  }
}
export async function resolveDestination(
  url: URL,
  allowlist: InternalAllowlist = {},
  resolve = async (host: string) =>
    (await lookup(host, { all: true, verbatim: true })).map((item) => item.address),
) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const explicit = allowlist[url.origin];
  const addresses = explicit ? [...explicit] : isIP(host) ? [host] : await resolve(host);
  if (
    !addresses.length ||
    addresses.length > 16 ||
    addresses.some(
      (ip) =>
        !isIP(ip) ||
        metadata.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4') ||
        (!explicit && !publicAddress(ip)),
    )
  )
    throw new QBError(
      'DESTINATION_DENIED',
      'Webhook destination resolves to a prohibited network',
      400,
    );
  // Pin one validated address. HTTPS keeps the original Host, SNI and certificate checks.
  return { address: addresses[0]!, family: isIP(addresses[0]!) as 4 | 6 };
}
export interface DeliveryResult {
  success: boolean;
  retryable?: boolean;
  code: string;
}
export async function deliverWebhook(
  delivery: WebhookDelivery,
  options: {
    allowlist?: InternalAllowlist;
    signal?: AbortSignal;
    resolve?: (host: string) => Promise<string[]>;
  } = {},
): Promise<DeliveryResult> {
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(10000),
  ]);
  try {
    const url = webhookURL(delivery.url);
    if (Buffer.byteLength(delivery.body) > 65536)
      return { success: false, code: 'EVENT_TOO_LARGE' };
    // DNS can hang; race it against the same request deadline without dispatching late results.
    const pinned = await new Promise<Awaited<ReturnType<typeof resolveDestination>>>(
      (resolve, reject) => {
        const abort = () => reject(new Error('aborted'));
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        resolveDestination(url, options.allowlist, options.resolve)
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort));
      },
    );
    signal.throwIfAborted();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: 'POST',
          agent: false,
          signal,
          // Never forward arbitrary headers, management cookies or worker credentials.
          headers: {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(delivery.body)),
            'x-qb-event-id': delivery.headers['x-qb-event-id']!,
            'x-qb-timestamp': delivery.headers['x-qb-timestamp']!,
            'x-qb-signature': delivery.headers['x-qb-signature']!,
          },
          lookup: (_hostname, lookupOptions, callback) => {
            // Newer runtimes request all records; both paths return only the pinned address.
            if (lookupOptions.all) callback(null, [pinned] as any);
            else callback(null, pinned.address, pinned.family);
          },
        },
        (response) => {
          // Do not read/log provider bodies. No redirects and no connection reuse.
          const code = response.statusCode ?? 0;
          response.destroy();
          resolve(code);
        },
      );
      req.on('error', reject);
      req.end(delivery.body);
    });
    if (status >= 200 && status < 300) return { success: true, code: 'PROVIDER_ACCEPTED' };
    if (status >= 300 && status < 400) return { success: false, code: 'REDIRECT_DENIED' };
    return {
      success: false,
      retryable: status === 408 || status === 429 || status >= 500,
      code: status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_REJECTED',
    };
  } catch (error) {
    if (error instanceof QBError && error.code === 'DESTINATION_DENIED')
      return { success: false, code: error.code };
    return {
      success: false,
      retryable: true,
      code: signal.aborted ? 'DELIVERY_TIMEOUT' : 'DELIVERY_UNAVAILABLE',
    };
  }
}
