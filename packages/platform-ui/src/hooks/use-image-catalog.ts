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
 * Register an entry against a source — the one write the catalog has.
 *
 * Both callers are the same `POST`, because both are the same act. Describing
 * a discovered entry writes the sentence for a source the platform already
 * built from, and the id derives from that source, so the row lands at the
 * identity the listing was already showing rather than beside it. Adding an
 * entry by hand names a source nobody has built here yet, and gets a row with
 * no versions until something builds one.
 *
 * The response is a probed view — `createImageCatalogEntry` probes capabilities
 * in the same request — which is why this is the moment a card stops saying
 * "not probed". No optimistic update: the probe is the point, and guessing the
 * answer locally to correct it a second later is worse than a pending button.
 */
export function useCatalogueImage(namespace: string) {
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

/**
 * Build one version of a built entry, without running a workflow.
 *
 * The request stays open for the whole build — minutes, not the sub-second the
 * other mutations take — so the caller must keep its pending state visible
 * rather than treating this as a click that settles. On success both reads are
 * invalidated: the new version is on the daemon, and every version fact is
 * recomputed per read, so an invalidate is the whole update (#1344).
 */
export function useBuildImageVersion(namespace: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { repo: string; commit: string; dockerfile: string }) =>
      mediforce.imageCatalog.build({ namespace, ...input }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imageCatalog.list(namespace) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.imageCatalogEntry(namespace, data.entryId),
      });
    },
  });
}
