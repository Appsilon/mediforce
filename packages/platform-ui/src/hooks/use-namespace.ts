'use client';

import { useQuery } from '@tanstack/react-query';
import type { Namespace, NamespaceMember } from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

export interface UseNamespaceResult {
  namespace: Namespace | null;
  members: NamespaceMember[];
  loading: boolean;
  error: Error | null;
}

/**
 * Workspace detail fetch keyed under `['namespace', handle]`. ONE-SHOT per
 * ADR-0006 §4 sub-case (a): workspace metadata changes via deliberate user
 * action (settings save), so `refetchOnWindowFocus: true` is the safety net.
 */
export function useNamespace(handle: string | undefined | null): UseNamespaceResult {
  const enabled = typeof handle === 'string' && handle !== '';
  const query = useQuery({
    queryKey: queryKeys.namespace(enabled ? handle : ''),
    queryFn: () => mediforce.namespaces.get({ handle: handle as string }),
    enabled,
    refetchOnWindowFocus: true,
    retry: stopRetryOn4xx,
  });

  const err = enabled ? (query.error as Error | null) ?? null : null;
  const notFound = err instanceof ApiError && err.status === 404;

  return {
    namespace: enabled ? query.data?.namespace ?? null : null,
    members: enabled ? query.data?.members ?? [] : [],
    loading: query.isLoading && enabled,
    error: notFound ? null : err,
  };
}
