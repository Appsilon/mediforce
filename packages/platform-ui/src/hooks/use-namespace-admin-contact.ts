'use client';

import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

export function useNamespaceAdminContact(handle: string | undefined): {
  email: string | null;
  displayName: string | null;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.namespaceMembers(handle ?? ''),
    queryFn: async () => mediforce.users.listMembers({ namespace: handle as string }),
    enabled: typeof handle === 'string' && handle.length > 0,
    retry: stopRetryOn4xx,
    staleTime: 5 * 60 * 1000,
  });

  const owner =
    query.data?.members.filter((m) => m.role === 'owner').sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0] ??
    null;

  return {
    email: owner?.email ?? null,
    displayName: owner?.displayName ?? null,
    isLoading: query.isLoading,
  };
}
