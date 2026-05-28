import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Wraps `renderHook(...)` so the hook under test sees a fresh `QueryClient`.
 * `retry: false` so a thrown query surfaces immediately instead of triggering
 * the project default of `retry: 2`.
 */
export function createQueryWrapper(): {
  wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, queryClient };
}
