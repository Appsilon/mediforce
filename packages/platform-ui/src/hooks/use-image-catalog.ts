'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import type { ImageCapabilities } from '@mediforce/platform-core';

/**
 * Daemon image ID → the capabilities probed when the image was catalogued,
 * flattened across every entry's versions.
 *
 * NICE LIVE (30 s): the catalog only changes when a member registers or edits
 * an entry, but an editor left open must pick that up — an image whose probe
 * failed at registration stays offered without a suitability claim until a
 * later probe answers.
 */
export function useImageCapabilities(
  namespace: string | undefined,
): Record<string, ImageCapabilities> {
  const query = useQuery({
    queryKey: queryKeys.imageCatalog.list(namespace ?? ''),
    queryFn: async () => {
      const { entries } = await mediforce.imageCatalog.list({ namespace: namespace ?? '' });
      return entries;
    },
    enabled: namespace !== undefined && namespace !== '',
    staleTime: NICE_LIVE_INTERVAL_MS,
    refetchInterval: (q) => (q.state.error !== null ? false : NICE_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
  });

  const entries = query.data;
  return useMemo(() => Object.fromEntries(
    (entries ?? []).flatMap((entry) =>
      entry.versions.map((version) => [version.imageId, version.capabilities] as const),
    ),
  ), [entries]);
}
