'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import type { GetMeOutput } from '@mediforce/platform-api/contract';

/**
 * Single source of truth for the signed-in user's identity + workspace
 * memberships. Powers the sidebar switcher, role gates, and every selector
 * hook (`useNamespaceRole`, `useAllUserNamespaces`, `usePersonalNamespace`).
 *
 * ONE-SHOT per ADR-0006 §4 sub-case (b): role / membership changes are an
 * intentional backend-403 canary rather than a silent UI mutation. Polling
 * stays off; focus-refetch is also off. Cache is invalidated by membership
 * mutations (invite accept, namespace create) and on sign-out.
 *
 * `enabled` lets `AuthProvider` gate the fetch on Firebase Auth resolving.
 * Default `true` — most consumers mount inside an authenticated layout where
 * `mediforce.users.me()` will succeed.
 */
export function useUserMe(options?: { enabled?: boolean }) {
  return useQuery<GetMeOutput, Error>({
    queryKey: queryKeys.users.me(),
    queryFn: () => mediforce.users.me(),
    enabled: options?.enabled ?? true,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
  });
}
