'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JoinLinkView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

export interface UseJoinLinksResult {
  links: JoinLinkView[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * A workspace's join links (ADR-0021), newest first.
 *
 * ONE-SHOT per ADR-0006 §4 sub-case (a): links change through deliberate
 * action — mint and revoke here (each invalidates), and an anonymous redemption
 * or another admin elsewhere. The second kind is why focus refetch is on:
 * `uses`, exhaustion and revocation all move while this tab is backgrounded,
 * and a settings page nobody is watching is not worth a poll but is worth being
 * true the moment somebody looks at it again.
 *
 * `enabled` is the caller's call: only owner/admin may read this, and asking as
 * a plain member would 403 on every render.
 */
export function useJoinLinks(handle: string, enabled: boolean): UseJoinLinksResult {
  const qc = useQueryClient();
  const active = enabled && handle !== '';
  const query = useQuery({
    queryKey: queryKeys.namespaceJoinLinks(active ? handle : '__noop__'),
    queryFn: async () => mediforce.joinLinks.list({ namespaceHandle: handle }),
    enabled: active,
    refetchOnWindowFocus: true,
    retry: stopRetryOn4xx,
  });

  return {
    links: query.data?.links ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.namespaceJoinLinks(handle) });
    },
  };
}
