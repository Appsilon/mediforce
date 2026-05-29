'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HumanTask } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { snapshotCache } from '@/lib/optimistic';
import { cn } from '@/lib/utils';

/**
 * State-transition optimistic update template per ADR-0006 §6:
 *
 * - `onMutate` cancels in-flight queries for the affected keys, snapshots
 *   the detail entity, and patches it locally to `status: 'claimed'` so
 *   the UI reflects the click instantly.
 * - `onSuccess` overwrites the detail key with the server entity-echo
 *   (`data.task`) — no refetch round trip — and invalidates the
 *   `['tasks']` list prefix so every role / instance slice picks the new
 *   state up on its next tick (tag-prefix invalidation per ADR-0006 §2).
 * - `onError` restores the snapshot and surfaces a message inline. The
 *   `['tasks']` prefix is also invalidated so any stale optimistic flicker
 *   on adjacent list views recovers.
 */
export function ClaimButton({
  taskId,
  fullWidth = false,
  variant = 'default',
  onClaimed,
}: {
  taskId: string;
  fullWidth?: boolean;
  variant?: 'default' | 'inline';
  onClaimed?: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const claim = useMutation({
    mutationFn: () => mediforce.tasks.claim({ taskId }),
    onMutate: async () => {
      const detailKey = queryKeys.task(taskId);
      await qc.cancelQueries({ queryKey: detailKey });
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all() });

      const { restore } = snapshotCache(qc, [detailKey]);
      qc.setQueryData<HumanTask | undefined>(detailKey, (old) =>
        old ? { ...old, status: 'claimed' } : old,
      );
      return { restore };
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.task(data.task.id), data.task);
      onClaimed?.();
    },
    onError: (err, _input, ctx) => {
      ctx?.restore();
      setError(err instanceof Error ? err.message : 'Failed to claim task');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.all() });
    },
  });

  function handleClaim() {
    setError(null);
    claim.mutate();
  }

  const pending = claim.isPending;

  if (variant === 'inline') {
    return (
      <button
        onClick={handleClaim}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Claim'}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleClaim}
        disabled={pending}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary',
          'hover:bg-primary hover:text-primary-foreground transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          fullWidth && 'w-full',
        )}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? 'Claiming...' : 'Claim Task'}
      </button>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
