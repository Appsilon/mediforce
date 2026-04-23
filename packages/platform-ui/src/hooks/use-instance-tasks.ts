'use client';

import { useEffect, useState } from 'react';
import type { HumanTask } from '@mediforce/platform-core';
import { mediforce, ApiError } from '@/lib/mediforce';

/**
 * Fetches the full set of human tasks belonging to a single process instance
 * through `mediforce.tasks.list`. One-shot read (no real-time subscription) —
 * intended for historical / contextual views where a stale read is acceptable.
 *
 * For live task lists (badge counts, active-task inboxes) keep using the
 * Firestore-backed `useCollection` hooks until Phase 6 lands a streaming
 * replacement — see `docs/headless-migration.md`.
 */
export function useInstanceTasks(instanceId: string | undefined): {
  tasks: HumanTask[];
  loading: boolean;
  error: Error | null;
} {
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [loading, setLoading] = useState<boolean>(instanceId !== undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (instanceId === undefined) {
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    mediforce.tasks
      .list({ instanceId })
      .then((result) => {
        if (!cancelled) setTasks(result.tasks);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const normalised = err instanceof ApiError || err instanceof Error
          ? err
          : new Error(String(err));
        setError(normalised);
        setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  return { tasks, loading, error };
}
