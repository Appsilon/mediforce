'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NamespaceMemberWithAuth } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

export type NamespaceMemberDetail = NamespaceMemberWithAuth & { id: string };

export interface UseNamespaceMembersResult {
  members: NamespaceMemberDetail[];
  loading: boolean;
  /**
   * Whether `members` is the roster the server returned, as opposed to the
   * empty array this hook shows while the read is in flight, after it failed,
   * or with no handle to read. A caller that reasons about what the roster does
   * NOT contain has to keep those apart — "nobody holds this role" and "we have
   * not been told yet" are the same empty list and mean opposite things.
   */
  resolved: boolean;
}

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Members of `handle`, owner first, keyed under `['namespace-members', handle]`
 * so a mutation can refresh the list by invalidating that key. ONE-SHOT per
 * ADR-0006 §4 sub-case (a): membership changes only through deliberate action
 * inside this page (invite, remove, role flip), each of which invalidates.
 *
 * `listMembers` carries the auth-side enrichment the member docs lack:
 * `lastSignInTime`, `email`, and a `displayName` fallback. Owner member docs
 * created before the createNamespace handler started persisting `displayName`
 * have none, so the handler falls back to the `auth_users` profile name and
 * legacy workspaces show a human name instead of the uid.
 */
export function useNamespaceMembers(handle: string): UseNamespaceMembersResult {
  const enabled = handle !== '';
  const query = useQuery({
    queryKey: queryKeys.namespaceMembers(enabled ? handle : '__noop__'),
    queryFn: async () => mediforce.users.listMembers({ namespace: handle }),
    enabled,
    retry: stopRetryOn4xx,
  });

  const fetched = query.data?.members;
  const members = useMemo(
    () =>
      (fetched ?? [])
        .map((member) => ({ ...member, id: member.uid }))
        .sort((memberA, memberB) => (ROLE_ORDER[memberA.role] ?? 3) - (ROLE_ORDER[memberB.role] ?? 3)),
    [fetched],
  );

  return { members, loading: query.isLoading, resolved: query.isSuccess };
}
