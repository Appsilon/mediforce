'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { where, orderBy } from 'firebase/firestore';
import type { HumanTask, CoworkSession } from '@mediforce/platform-core';
import { ACTIONABLE_STATUSES } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { useCollection } from './use-collection';

const STANDARD_LIVE_INTERVAL_MS = 5_000;

/**
 * Role-scoped actionable task queue, react-query backed (STANDARD LIVE per
 * ADR-0006 §4). Returns the same `{ data, loading, error }` shape as the
 * Firestore-backed `useMyTasks(null, …)` fallback below so callers swap
 * in mechanically once an "all my visible tasks" endpoint axis exists.
 */
export function useMyActionableTasksByRole(
  assignedRole: string | undefined,
  currentUserId?: string | null,
): { data: HumanTask[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.tasks.byRole(assignedRole ?? '', { status: [...ACTIONABLE_STATUSES] }),
    queryFn: async () => {
      const result = await mediforce.tasks.list({
        role: assignedRole as string,
        status: [...ACTIONABLE_STATUSES],
      });
      return result.tasks;
    },
    enabled: assignedRole !== undefined && assignedRole.length > 0,
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
  });

  const filtered = useMemo(() => {
    const tasks = query.data ?? [];
    const notDeleted = tasks.filter((t) => !t.deleted);
    if (currentUserId === undefined || currentUserId === null) return notDeleted;
    return notDeleted.filter(
      (t) => t.assignedUserId === null || t.assignedUserId === currentUserId,
    );
  }, [query.data, currentUserId]);

  return {
    data: filtered,
    loading: query.isLoading && assignedRole !== undefined && assignedRole.length > 0,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Role-scoped completed task list, react-query backed (STANDARD LIVE).
 * Sorts `completedAt` desc client-side — the API does not promise an order.
 */
export function useCompletedTasksByRole(
  assignedRole: string,
): { data: HumanTask[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.tasks.byRole(assignedRole, { status: ['completed'] }),
    queryFn: async () => {
      const result = await mediforce.tasks.list({
        role: assignedRole,
        status: ['completed'],
      });
      return result.tasks;
    },
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
  });

  const filtered = useMemo(() => {
    const tasks = (query.data ?? []).filter((t) => !t.deleted);
    return [...tasks].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }, [query.data]);

  return {
    data: filtered,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * @deprecated Firestore `onSnapshot` fallback retained only for the
 * `role === null` caller pattern (cross-role aggregation on workspace home,
 * workflow detail, runs list). Those call sites need an "all tasks visible
 * to me" axis on `mediforce.tasks.list` before they can migrate to
 * react-query — until that endpoint extension lands they keep working
 * against this hook unchanged. For the role-provided path, use
 * `useMyActionableTasksByRole` instead.
 */
export function useMyTasks(assignedRole: string | null, currentUserId?: string | null) {
  const constraints = useMemo(
    () =>
      assignedRole
        ? [
            where('assignedRole', '==', assignedRole),
            where('status', 'in', ['pending', 'claimed']),
            orderBy('createdAt', 'asc'),
          ]
        : [orderBy('createdAt', 'asc')],
    [assignedRole],
  );

  const { data, loading, error } = useCollection<HumanTask>('humanTasks', constraints);

  const filtered = useMemo(
    () => {
      const notDeleted = data.filter((task) => !task.deleted);
      // A task with an assignedUserId is scoped to its owner — only that user
      // sees it. Unassigned (null) tasks stay visible to everyone with the
      // role. When no currentUserId is supplied (overview widgets), skip the
      // scoping and show the role-wide queue.
      const mine = currentUserId
        ? notDeleted.filter(
            (task) => task.assignedUserId === null || task.assignedUserId === currentUserId,
          )
        : notDeleted;
      return assignedRole
        ? mine
        : mine.filter((task) => task.status !== 'completed');
    },
    [data, assignedRole, currentUserId],
  );

  return { data: filtered, loading, error };
}

/**
 * @deprecated Firestore fallback retained only for the `role === null` branch
 * — see `useMyTasks` for the rationale. For the role-provided path, use
 * `useCompletedTasksByRole` instead.
 */
export function useCompletedTasks(assignedRole: string | null) {
  const constraints = useMemo(
    () =>
      assignedRole
        ? [
            where('assignedRole', '==', assignedRole),
            where('status', '==', 'completed'),
            orderBy('completedAt', 'desc'),
          ]
        : [orderBy('createdAt', 'desc')],
    [assignedRole],
  );

  const { data, loading, error } = useCollection<HumanTask>('humanTasks', constraints);

  const filtered = useMemo(
    () => {
      const notDeleted = data.filter((task) => !task.deleted);
      return assignedRole
        ? notDeleted
        : notDeleted.filter((task) => task.status === 'completed');
    },
    [data, assignedRole],
  );

  return { data: filtered, loading, error };
}

export function useActiveTaskForInstance(processInstanceId: string | null) {
  const constraints = useMemo(
    () =>
      processInstanceId
        ? [
            where('processInstanceId', '==', processInstanceId),
            where('status', 'in', ['pending', 'claimed']),
          ]
        : [],
    [processInstanceId],
  );

  const { data, loading } = useCollection<HumanTask>(
    processInstanceId ? 'humanTasks' : '',
    constraints,
  );

  const activeTask = useMemo(
    () => data.find((task) => !task.deleted) ?? null,
    [data],
  );

  return { task: activeTask, loading };
}

export function useActiveCoworkSession(processInstanceId: string | null) {
  const constraints = useMemo(
    () =>
      processInstanceId
        ? [
            where('processInstanceId', '==', processInstanceId),
            where('status', '==', 'active'),
          ]
        : [],
    [processInstanceId],
  );

  const { data, loading } = useCollection<CoworkSession>(
    processInstanceId ? 'coworkSessions' : '',
    constraints,
  );

  const session = useMemo(
    () => data[0] ?? null,
    [data],
  );

  return { session, loading };
}

export function useMyCoworkSessions(assignedRole: string | null) {
  const constraints = useMemo(
    () =>
      assignedRole
        ? [
            where('assignedRole', '==', assignedRole),
            where('status', '==', 'active'),
            orderBy('createdAt', 'asc'),
          ]
        : [
            where('status', '==', 'active'),
            orderBy('createdAt', 'asc'),
          ],
    [assignedRole],
  );

  return useCollection<CoworkSession>('coworkSessions', constraints);
}

export function useFinalizedCoworkSessions(assignedRole: string | null) {
  const constraints = useMemo(
    () =>
      assignedRole
        ? [
            where('assignedRole', '==', assignedRole),
            where('status', '==', 'finalized'),
            orderBy('finalizedAt', 'desc'),
          ]
        : [
            where('status', '==', 'finalized'),
            orderBy('finalizedAt', 'desc'),
          ],
    [assignedRole],
  );

  return useCollection<CoworkSession>('coworkSessions', constraints);
}
