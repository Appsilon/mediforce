'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditEvent } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

/**
 * Every audit event for a workspace (Monitoring → Users tab) — sign-ins,
 * workflow triggers/cancels, task completions, across every user. STANDARD
 * LIVE per ADR-0006 §4, matching the other list-style monitoring reads.
 */
export function useNamespaceAuditEvents(handle: string): {
  data: AuditEvent[];
  loading: boolean;
} {
  const enabled = handle.length > 0;
  const query = useQuery({
    queryKey: enabled ? queryKeys.namespaceAuditEvents(handle) : queryKeys.namespaceAuditEvents('__noop__'),
    queryFn: async () => {
      const result = await mediforce.processes.listNamespaceAuditEvents({ namespace: handle });
      return result.events;
    },
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  return {
    data: query.data ?? [],
    loading: enabled && query.isLoading,
  };
}

/**
 * uid → display name (falls back to email, then the uid itself) for a
 * workspace's members.
 */
export function useNamespaceMemberNames(handle: string): Map<string, string> {
  const enabled = handle.length > 0;
  const query = useQuery({
    queryKey: enabled ? queryKeys.namespaceMembers(handle) : queryKeys.namespaceMembers('__noop__'),
    queryFn: async () => mediforce.users.listMembers({ namespace: handle }),
    enabled,
    retry: stopRetryOn4xx,
    staleTime: 5 * 60 * 1000,
  });

  const members = query.data?.members ?? [];
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.uid, member.displayName ?? member.email ?? member.uid);
    }
    return map;
  }, [members]);
}
