'use client';

import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

/**
 * Primary-owner contact for a workspace, surfaced to any member (e.g. the
 * run-start preflight "contact your admin" hint). Reads the workspace detail
 * endpoint's `adminContact` — the member roster gates every other email to
 * admins, so this dedicated field is the one contact a plain member may see.
 */
export function useNamespaceAdminContact(handle: string | undefined): {
  email: string | null;
  displayName: string | null;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.namespace(handle ?? ''),
    queryFn: async () => mediforce.namespaces.get({ handle: handle as string }),
    enabled: typeof handle === 'string' && handle.length > 0,
    retry: stopRetryOn4xx,
    staleTime: 5 * 60 * 1000,
  });

  return {
    email: query.data?.adminContact?.email ?? null,
    displayName: query.data?.adminContact?.displayName ?? null,
    isLoading: query.isLoading,
  };
}
