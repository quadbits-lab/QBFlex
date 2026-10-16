import { ManagementClient } from '@qb-flex/management-client';
import { studioAPIURL } from './api-url';
export const apiURL = studioAPIURL(
  import.meta.env.VITE_API_URL ?? 'http://localhost:7612',
  typeof window === 'undefined' ? undefined : window.location.hostname,
);
export const docsURL = import.meta.env.VITE_DOCS_URL ?? 'http://localhost:7611';
export const management = new ManagementClient(apiURL);
export async function raw(
  path: string,
  method = 'GET',
  body?: unknown,
  options: { signal?: AbortSignal; cache?: RequestCache } = {},
) {
  const response = await fetch(apiURL + path, {
    ...options,
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? value.message ?? 'Request failed');
  return value;
}
