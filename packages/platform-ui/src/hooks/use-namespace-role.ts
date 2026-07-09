'use client';

import { useUserMe } from './use-user-me';
import type { MeNamespace } from '@mediforce/platform-api/contract';

export interface UseNamespaceRoleResult {
  role: MeNamespace['role'] | null;
  canAdmin: boolean;
  loading: boolean;
}

/**
 * Pure selector over `useUserMe()`. The user's role in `handle` is taken
 * directly from the bundled identity payload — no extra fetch, no Firestore
 * subscription. When `useUserMe` is loading or the user is not a member,
 * `role` is `null` and `canAdmin` is `false`.
 */
export function useNamespaceRole(handle: string): UseNamespaceRoleResult {
  const query = useUserMe();
  if (query.isLoading) {
    return { role: null, canAdmin: false, loading: true };
  }
  const entry = query.data?.namespaces.find((n) => n.handle === handle);
  const role = entry?.role ?? null;
  return {
    role,
    canAdmin: role === 'owner' || role === 'admin',
    loading: false,
  };
}
