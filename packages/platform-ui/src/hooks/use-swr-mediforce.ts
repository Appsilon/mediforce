'use client';

import useSWR from 'swr';
import type { SWRConfiguration } from 'swr';

/**
 * Shared SWR wrapper for browser hooks that previously used Firestore
 * onSnapshot. Per PLAN-0001 §3 (ADR-0001 transition), realtime listeners are
 * being replaced with `useSWR(url, fetcher, { refreshInterval })` so the data
 * layer can move off Firestore. Two tiers per PLAN:
 *   - LIVE_INTERVAL_MS (1s): live-changing data (runs, tasks, agent runs).
 *   - RETRO_INTERVAL_MS (5s): retro / static data (audit events, workflow
 *     definitions, namespaces).
 *
 * Keys are `[scope, ...args]` tuples; the fetcher receives the same tuple, so
 * each hook owns its own typed call into `mediforce.X.Y(...)`.
 */
export const LIVE_INTERVAL_MS = 1000;
export const RETRO_INTERVAL_MS = 5000;

export function useLive<Key extends readonly unknown[] | null, Data>(
  key: Key,
  fetcher: (key: NonNullable<Key>) => Promise<Data>,
  config?: SWRConfiguration<Data>,
) {
  return useSWR<Data>(key, key === null ? null : () => fetcher(key as NonNullable<Key>), {
    refreshInterval: LIVE_INTERVAL_MS,
    revalidateOnFocus: true,
    ...config,
  });
}

export function useRetro<Key extends readonly unknown[] | null, Data>(
  key: Key,
  fetcher: (key: NonNullable<Key>) => Promise<Data>,
  config?: SWRConfiguration<Data>,
) {
  return useSWR<Data>(key, key === null ? null : () => fetcher(key as NonNullable<Key>), {
    refreshInterval: RETRO_INTERVAL_MS,
    revalidateOnFocus: true,
    ...config,
  });
}
