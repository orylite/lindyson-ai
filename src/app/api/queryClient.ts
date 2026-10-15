import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

export function privateQueryKey(sessionEpoch: number, ...parts: readonly unknown[]) {
  return ['private', sessionEpoch, ...parts] as const;
}

export async function clearPrivateQueryCache() {
  await queryClient.cancelQueries({ queryKey: ['private'] });
  queryClient.removeQueries({ queryKey: ['private'] });
}
