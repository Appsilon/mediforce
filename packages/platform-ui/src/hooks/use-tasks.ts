'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HumanTask, CoworkSession } from '@mediforce/platform-core';
import { ACTIONABLE_STATUSES } from '@mediforce/platform-api/contract';
import { mediforce, ApiError } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';

import { CRITICAL_LIVE_INTERVAL_MS, STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

function retryOn5xx(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  return failureCount < 2;
}

/**
 * Role-scoped actionable task queue, react-query backed (STANDARD LIVE per
 * ADR-0006 §4).
 */
export function useMyActionableTasksByRole(
  assignedRole: string | undefined,
  currentUserId?: string | null,
): { data: HumanTask[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.tasks.byRole(assignedRole ?? '', { status: [...ACTIONABLE_STATUSES] }),
    queryFn: async () => {
      if (assignedRole === undefined) throw new Error('unreachable: enabled gates this');
      const result = await mediforce.tasks.list({
        role: assignedRole,
        status: [...ACTIONABLE_STATUSES],
      });
      return result.tasks;
    },
    enabled: assignedRole !== undefined && assignedRole.length > 0,
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
    retry: retryOn5xx,
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
 * Caller-scope actionable queue: every actionable task across the caller's
 * workspaces, irrespective of role. Powered by the GitHub-like default on
 * `mediforce.tasks.list` (no `instanceId` / `role` ⇒ caller scope).
 * STANDARD LIVE per ADR-0006 §4.
 */
export function useMyActionableTasks(
  currentUserId?: string | null,
): { data: HumanTask[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.tasks.forCaller({ status: [...ACTIONABLE_STATUSES] }),
    queryFn: async () => {
      const result = await mediforce.tasks.list({ status: [...ACTIONABLE_STATUSES] });
      return result.tasks;
    },
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
    retry: retryOn5xx,
  });

  const filtered = useMemo(() => {
    const tasks = (query.data ?? []).filter((t) => !t.deleted);
    if (currentUserId === undefined || currentUserId === null) return tasks;
    return tasks.filter(
      (t) => t.assignedUserId === null || t.assignedUserId === currentUserId,
    );
  }, [query.data, currentUserId]);

  return {
    data: filtered,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Role-scoped completed task list, react-query backed (STANDARD LIVE).
 * Sorts `completedAt` desc client-side — the API does not promise an order.
 */
export function useCompletedTasksByRole(
  assignedRole: string | undefined,
): { data: HumanTask[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.tasks.byRole(assignedRole ?? '', { status: ['completed'] }),
    queryFn: async () => {
      if (assignedRole === undefined) throw new Error('unreachable: enabled gates this');
      const result = await mediforce.tasks.list({
        role: assignedRole,
        status: ['completed'],
      });
      return result.tasks;
    },
    enabled: assignedRole !== undefined && assignedRole.length > 0,
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
    retry: retryOn5xx,
  });

  const filtered = useMemo(() => {
    const tasks = (query.data ?? []).filter((t) => !t.deleted);
    return [...tasks].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }, [query.data]);

  return {
    data: filtered,
    loading: query.isLoading && assignedRole !== undefined && assignedRole.length > 0,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Caller-scope completed task list (cross-role). STANDARD LIVE.
 */
export function useMyCompletedTasks(): { data: HumanTask[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.tasks.forCaller({ status: ['completed'] }),
    queryFn: async () => {
      const result = await mediforce.tasks.list({ status: ['completed'] });
      return result.tasks;
    },
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
    retry: retryOn5xx,
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
 * Active blocking task for a process instance. CRITICAL LIVE — operators
 * watch this to know when the run unblocks. Returns `null` when no actionable
 * task is open against the instance.
 */
export function useActiveTaskForInstance(
  processInstanceId: string | null,
): { task: HumanTask | null; loading: boolean } {
  const enabled = processInstanceId !== null && processInstanceId.length > 0;
  const query = useQuery({
    queryKey: enabled
      ? queryKeys.tasks.byInstance(processInstanceId, { status: [...ACTIONABLE_STATUSES] })
      : (['tasks', '__noop__'] as const),
    queryFn: async () => {
      if (processInstanceId === null) throw new Error('unreachable: enabled gates this');
      const result = await mediforce.tasks.list({
        instanceId: processInstanceId,
        status: [...ACTIONABLE_STATUSES],
      });
      return result.tasks;
    },
    enabled,
    refetchInterval: CRITICAL_LIVE_INTERVAL_MS,
    retry: retryOn5xx,
  });

  const activeTask = useMemo(
    () => (query.data ?? []).find((task) => !task.deleted) ?? null,
    [query.data],
  );

  return { task: activeTask, loading: enabled && query.isPending };
}

/**
 * Active cowork session for a process instance, when one exists. CRITICAL
 * LIVE. The server `getByInstance` endpoint returns the session if any —
 * a 404 surfaces here as `session: null` so callers can branch cleanly.
 */
export function useActiveCoworkSession(
  processInstanceId: string | null,
): { session: CoworkSession | null; loading: boolean } {
  const enabled = processInstanceId !== null && processInstanceId.length > 0;
  const query = useQuery({
    queryKey: enabled
      ? queryKeys.cowork.byInstance(processInstanceId)
      : queryKeys.cowork.byInstance('__noop__'),
    queryFn: () => {
      if (processInstanceId === null) throw new Error('unreachable: enabled gates this');
      return mediforce.cowork.getByInstance({ instanceId: processInstanceId });
    },
    enabled,
    // 404 = no cowork session yet. Stop polling — a state transition from
    // "no session" to "session exists" originates from a UI mutation
    // (`mediforce.cowork.create` callsite), which must invalidate this
    // cache key. Without the stop, every instance page without a session
    // polls 40 req/min indefinitely.
    refetchInterval: (q) =>
      q.state.error instanceof ApiError && q.state.error.status === 404
        ? false
        : CRITICAL_LIVE_INTERVAL_MS,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return retryOn5xx(failureCount, err);
    },
  });

  const err = query.error;
  const notFound = err instanceof ApiError && err.status === 404;
  const session = notFound ? null : query.data ?? null;
  return {
    session: session !== null && session.status === 'active' ? session : null,
    loading: enabled && query.isPending,
  };
}

/**
 * Active cowork sessions assigned to a role, react-query backed (STANDARD
 * LIVE per ADR-0006 §4). When `role` is `null` returns all sessions visible
 * to the caller across roles. Sorted `createdAt` asc client-side to preserve
 * the old Firestore ordering — the contract does not promise an order.
 */
export function useMyCoworkSessions(
  assignedRole: string | null,
): { data: CoworkSession[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: ['cowork', 'list', { role: assignedRole, status: ['active'] }] as const,
    queryFn: async () => {
      const result = await mediforce.cowork.list({
        role: assignedRole ?? undefined,
        status: ['active'],
      });
      return result.sessions;
    },
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
    retry: retryOn5xx,
  });

  const sorted = useMemo(() => {
    return [...(query.data ?? [])].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }, [query.data]);

  return {
    data: sorted,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Finalized cowork sessions assigned to a role, react-query backed
 * (STANDARD LIVE). Sorted `finalizedAt` desc client-side.
 */
export function useFinalizedCoworkSessions(
  assignedRole: string | null,
): { data: CoworkSession[]; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: ['cowork', 'list', { role: assignedRole, status: ['finalized'] }] as const,
    queryFn: async () => {
      const result = await mediforce.cowork.list({
        role: assignedRole ?? undefined,
        status: ['finalized'],
      });
      return result.sessions;
    },
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
    retry: retryOn5xx,
  });

  const sorted = useMemo(() => {
    return [...(query.data ?? [])].sort((a, b) => (b.finalizedAt ?? '').localeCompare(a.finalizedAt ?? ''));
  }, [query.data]);

  return {
    data: sorted,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
