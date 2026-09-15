'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';

/**
 * The namespace's catalog, grouped by base and roots-first — the order the
 * handler computed, which is the grouping the Images view renders.
 *
 * NICE LIVE (30 s): the stored half only changes when a member registers or
 * edits an entry, and the derived half — versions, availability, lineage — is
 * recomputed per read from the daemon, so a build that finishes while the page
 * is open shows up within the cadence. An editor left open must pick that up:
 * an image whose probe failed at registration stays offered without a
 * suitability claim until a later probe answers.
 *
 * `undefined` is a namespace not resolved yet, not an error — nothing is
 * fetched and the caller renders on the empty list.
 */
export function useImageCatalogEntries(namespace: string | undefined): {
  entries: ImageCatalogEntryView[];
  loading: boolean;
  error: Error | null;
} {
  const query = useQuery({
    queryKey: queryKeys.imageCatalog.list(namespace ?? ''),
    queryFn: async () => (await mediforce.imageCatalog.list({ namespace: namespace ?? '' })).entries,
    enabled: namespace !== undefined && namespace !== '',
    staleTime: NICE_LIVE_INTERVAL_MS,
    refetchInterval: (q) => (q.state.error !== null ? false : NICE_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
  });

  return {
    entries: query.data ?? [],
    loading: query.isPending && namespace !== undefined && namespace !== '',
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
 *
 * NICE LIVE (30 s) while expanded, the same cadence as the listing: an expanded
 * card renders this read in preference to the list row, so leaving it un-polled
 * would freeze versions, availability, capabilities and lineage at the moment
 * of expansion while the rest of the page kept moving. Collapsed, `enabled` is
 * false and nothing is polled — and the view expands one entry at a time, so
 * the `docker history` calls above are paid for one entry, never a catalog.
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
    refetchInterval: (q) => (q.state.error !== null ? false : NICE_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
  });

  return {
    entry: query.data,
    loading: query.isPending && enabled,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Describe a discovered entry — the sentence the platform cannot derive.
 *
 * A plain create: a discovered entry is not a row, so writing the sentence is
 * what registers it, and the id is derived from the source it already carries,
 * so the entry keeps the identity the listing showed. The response is a probed
 * view — `createImageCatalogEntry` probes capabilities in the same request —
 * which is why this is the moment the card stops saying "not probed".
 *
 * No optimistic update. The probe is the point: guessing the answer locally
 * and correcting it a second later is worse than a pending button.
 */
export function useDescribeImage(namespace: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; intent: string; source: ImageCatalogEntryView['source'] }) =>
      mediforce.imageCatalog.create({ namespace, ...input }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imageCatalog.list(namespace) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.imageCatalogEntry(namespace, data.entry.id),
      });
    },
  });
}
