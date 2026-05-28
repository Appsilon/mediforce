import { QueryClient } from '@tanstack/react-query';

/**
 * Project-wide defaults per ADR-0006 §3.
 *
 * Polling is OFF by default; per-hook opt-in via `refetchInterval` (or the
 * four-tier `refetchInterval` matrix in §4). Mutations never auto-retry.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        staleTime: 0,
        gcTime: 5 * 60 * 1000,
        retry: 2,
        retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
