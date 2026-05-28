'use client';

import { useUserMe } from './use-user-me';
import type { MeNamespace } from '@mediforce/platform-api/contract';

export interface UseAllUserNamespacesResult {
  namespaces: MeNamespace[];
  loading: boolean;
}

/**
 * Pure selector over `useUserMe()`. Returns the full list of namespaces the
 * caller belongs to (personal + organisation). The `_uid` parameter is
 * accepted for source-compat with the pre-Phase-4 signature — the value is
 * ignored because the bundle is keyed off the verified bearer token, not a
 * client-supplied uid.
 */
export function useAllUserNamespaces(_uid?: string | null): UseAllUserNamespacesResult {
  const query = useUserMe();
  return {
    namespaces: query.data?.namespaces ?? [],
    loading: query.isLoading,
  };
}
