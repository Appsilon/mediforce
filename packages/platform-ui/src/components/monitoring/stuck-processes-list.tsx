'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import type { ProcessInstance } from '@mediforce/platform-core';

export function StuckProcessesList({
  processes,
  loading,
}: {
  processes: ProcessInstance[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (processes.length === 0) {
    return (
      <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-300">
        No stuck processes — all workflows are advancing normally.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {processes.map((inst) => {
        const pausedSince = inst.createdAt;
        return (
          <div
            key={inst.id}
            className="flex items-start gap-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <Link
                  href={`/processes/${inst.id}`}
                  className="font-medium text-sm hover:text-primary transition-colors truncate"
                >
                  {inst.definitionName}
                </Link>
                <span className="text-xs text-muted-foreground shrink-0">
                  paused {formatDistanceToNow(new Date(pausedSince), { addSuffix: true })}
                </span>
              </div>
              {inst.pauseReason && (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  Reason: {inst.pauseReason.replace(/_/g, ' ')}
                </div>
              )}
              {inst.currentStepId && (
                <div className="text-xs text-muted-foreground font-mono">
                  Stuck at: {inst.currentStepId}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
