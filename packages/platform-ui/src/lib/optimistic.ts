import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Snapshot a set of cache entries for rollback per ADR-0006 §6 templates.
 *
 * Pattern (state-transition template, called from `useMutation.onMutate`):
 *
 *   await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })));
 *   const { restore } = snapshotCache(qc, keys);
 *   qc.setQueryData(detailKey, optimisticEntity);
 *   qc.setQueryData(listKey, (old) => patch(old));
 *   return { restore };
 *
 * Then in `onError(_e, _input, ctx)` call `ctx.restore()`; in `onSuccess`
 * replace with the server entity-echo via `setQueryData`.
 *
 * Why a helper at all: forgetting to restore one of the affected keys is
 * the recurring bug in hand-rolled optimistic flows. Snapshotting in one
 * place eliminates that class of mistake.
 */
export function snapshotCache(qc: QueryClient, keys: readonly QueryKey[]): {
  restore: () => void;
} {
  const entries = keys.map((key) => [key, qc.getQueryData(key)] as const);
  return {
    restore: () => {
      for (const [key, value] of entries) {
        if (value === undefined) {
          qc.removeQueries({ queryKey: key, exact: true });
        } else {
          qc.setQueryData(key, value);
        }
      }
    },
  };
}
