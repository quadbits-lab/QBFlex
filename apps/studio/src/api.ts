import { ManagementClient } from '@qb-flex/management-client';
export const apiURL = import.meta.env.VITE_API_URL ?? 'http://localhost:7612';
export const docsURL = import.meta.env.VITE_DOCS_URL ?? 'http://localhost:7611';
export const management = new ManagementClient(apiURL);
export async function raw(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(apiURL + path, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? value.message ?? 'Request failed');
  return value;
}
