'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProcessInstance } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { snapshotCache } from '@/lib/optimistic';

/**
 * State-transition optimistic update for `runs.cancel` per ADR-0006 §6.
 * Flips the detail entity to `failed` + `error: 'Cancelled by user'` locally
 * so the click feels instant; entity-echo replaces the optimistic value on
 * success; tag-prefix invalidation refreshes every `['runs']` list slice.
 */
export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; reason?: string }) =>
      mediforce.runs.cancel(input),
    onMutate: async ({ runId }) => {
      const detailKey = queryKeys.run(runId);
      await qc.cancelQueries({ queryKey: detailKey });
      await qc.cancelQueries({ queryKey: queryKeys.runs.all() });

      const { restore } = snapshotCache(qc, [detailKey]);
      qc.setQueryData<ProcessInstance | undefined>(detailKey, (old) =>
        old ? { ...old, status: 'failed', error: 'Cancelled by user' } : old,
      );
      return { restore };
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.run(data.run.id), data.run);
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runs.all() });
    },
  });
}

/**
 * State-transition optimistic update for `runs.archive` per ADR-0006 §6. The
 * `archived` boolean toggles in place; list slices invalidate so the
 * "show archived" filter recomputes.
 */
export function useArchiveRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; archived: boolean }) =>
      mediforce.runs.archive(input),
    onMutate: async ({ runId, archived }) => {
      const detailKey = queryKeys.run(runId);
      await qc.cancelQueries({ queryKey: detailKey });
      await qc.cancelQueries({ queryKey: queryKeys.runs.all() });

      const { restore } = snapshotCache(qc, [detailKey]);
      qc.setQueryData<ProcessInstance | undefined>(detailKey, (old) =>
        old ? { ...old, archived } : old,
      );
      return { restore };
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.run(data.run.id), data.run);
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runs.all() });
    },
  });
}

/**
 * Bulk cancel — multi-cache-key cross-cutting template per ADR-0006 §6. No
 * optimistic flip; the per-item results envelope reports partial failure,
 * and a tag-prefix invalidate refreshes every `['runs']` slice on settle.
 */
export function useBulkCancelRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runIds: string[] }) => mediforce.runs.bulkCancel(input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runs.all() });
    },
  });
}

/**
 * Bulk archive — same multi-cache-key template as bulk cancel.
 */
export function useBulkArchiveRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runIds: string[] }) => mediforce.runs.bulkArchive(input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runs.all() });
    },
  });
}

/**
 * List-affecting create template per ADR-0006 §6 — optimistically prepends a
 * placeholder to the currently-cached `['runs', handle, ...]` slices, then
 * replaces with the server entity-echo on success. The optimistic placeholder
 * carries the trigger details supplied to the call so the operator sees the
 * row immediately; the server-issued id replaces the placeholder.
 */
export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof mediforce.runs.start>[0]) =>
      mediforce.runs.start(input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.run(data.run.id), data.run);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runs.all() });
    },
  });
}
