'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NamespaceMember } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';

export interface NamespaceMemberDetail extends NamespaceMember {
  id: string;
  email?: string | null;
  lastSignInTime?: string | null;
}

export interface UseNamespaceMembersResult {
  members: NamespaceMemberDetail[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Polled members list via the headless contract — replaces the previous
 * `onSnapshot(namespaces/{handle}/members)` subscription. Realtime updates
 * become a small staleness window (next `listMembers` tick after a mutation);
 * §"Phase 4 is a swap, not a redesign" accepts this regression.
 *
 * `listMembers` also carries the auth-side enrichment: `lastSignInTime`,
 * `email`, and a `displayName` fallback. Owner member docs created before the
 * createNamespace handler started persisting `displayName` lack it locally, so
 * the handler falls back to the `auth_users` profile name and legacy
 * workspaces show a human name instead of the uid.
 */
export function useNamespaceMembers(handle: string): UseNamespaceMembersResult {
  const [members, setMembers] = useState<NamespaceMemberDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (handle === '') return;
    try {
      const { members: fetched } = await mediforce.users.listMembers({ namespace: handle });
      setMembers(
        fetched.map((member) => ({
          ...member,
          id: member.uid,
          displayName: member.displayName ?? undefined,
        })),
      );
    } catch {
      // Non-fatal — the section renders its empty state instead.
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = useMemo(
    () =>
      [...members].sort(
        (memberA, memberB) => (ROLE_ORDER[memberA.role] ?? 3) - (ROLE_ORDER[memberB.role] ?? 3),
      ),
    [members],
  );

  return { members: sorted, loading, refresh };
}
