'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import type { ImageCapabilities } from '@mediforce/platform-core';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';

/**
 * The namespace's catalog, grouped by base and roots-first — the order the
 * handler computed, which is the grouping the Images view renders.
 *
 * NICE LIVE (30 s): the stored half only changes when a member registers or
 * edits an entry, and the derived half — versions, availability, lineage — is
 * recomputed per read from the daemon, so a build that finishes while the page
 * is open shows up within the cadence.
 */
export function useImageCatalogEntries(namespace: string): {
  entries: ImageCatalogEntryView[];
  loading: boolean;
  error: Error | null;
} {
  const query = useQuery({
    queryKey: queryKeys.imageCatalog.list(namespace),
    queryFn: async () => (await mediforce.imageCatalog.list({ namespace })).entries,
    enabled: namespace !== '',
    staleTime: NICE_LIVE_INTERVAL_MS,
    refetchInterval: (q) => (q.state.error !== null ? false : NICE_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
  });

  return {
    entries: query.data ?? [],
    loading: query.isPending && namespace !== '',
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * One entry, read on demand.
 *
 * Separate from the listing because the single-entry read is the only one that
 * carries `lineage.addedSteps` — a `docker history` per version, which the
 * listing cannot afford for a whole catalog. So the layer summary arrives when
 * a reader expands the entry that needs it, and never before.
 */
export function useImageCatalogEntry(
  namespace: string,
  id: string,
  enabled: boolean,
): { entry: ImageCatalogEntryView | undefined; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.imageCatalogEntry(namespace, id),
    queryFn: async () => (await mediforce.imageCatalog.get({ namespace, id })).entry,
    enabled: enabled && namespace !== '',
    staleTime: NICE_LIVE_INTERVAL_MS,
    retry: stopRetryOn4xx,
  });

  return {
    entry: query.data,
    loading: query.isPending && enabled,
    error: (query.error as Error | null) ?? null,
  };
}

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
