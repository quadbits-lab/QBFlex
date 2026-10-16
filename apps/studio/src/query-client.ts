import { MutationCache, QueryClient } from '@tanstack/react-query';

/** Cancel older reads before fetching post-write state; leave inactive views stale for navigation. */
export async function refreshStudioQueries(client: QueryClient) {
  await client.cancelQueries();
  // A failed refresh must not turn an acknowledged write into a failed submission/retry.
  await client.invalidateQueries({ refetchType: 'active' });
}

/** One cache per mounted root/SSR request, never a shared server singleton. */
export function createStudioQueryClient(onMutationError: (error: Error) => void) {
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: async () => {
        await refreshStudioQueries(client);
      },
    }),
    defaultOptions: {
      queries: { retry: false, staleTime: 5000 },
      mutations: { onError: onMutationError },
    },
  });
  return client;
}
