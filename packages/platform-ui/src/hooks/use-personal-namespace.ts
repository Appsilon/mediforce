'use client';

import { useUserMe } from './use-user-me';
import type { MeNamespace } from '@mediforce/platform-api/contract';

export interface UsePersonalNamespaceResult {
  namespace: MeNamespace | null;
  loading: boolean;
}

/**
 * Pure selector over `useUserMe()` — the caller's personal namespace, lazily
 * bootstrapped by `GET /api/users/me` if it didn't exist yet.
 */
export function usePersonalNamespace(): UsePersonalNamespaceResult {
  const query = useUserMe();
  const personal = query.data?.namespaces.find((n) => n.type === 'personal') ?? null;
  return { namespace: personal, loading: query.isLoading };
}
