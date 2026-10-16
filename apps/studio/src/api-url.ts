/** Keep local cookie requests on the browser's loopback host, without changing remote APIs. */
export function studioAPIURL(configured: string, browserHostname?: string) {
  const url = new URL(configured);
  const loopback = new Set(['localhost', '127.0.0.1']);
  if (browserHostname && loopback.has(browserHostname) && loopback.has(url.hostname))
    url.hostname = browserHostname;
  return url.toString().replace(/\/$/, '');
}
