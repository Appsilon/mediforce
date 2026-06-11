'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HumanTask, CoworkSession, InstanceStatus } from '@mediforce/platform-core';
import { ACTIONABLE_STATUSES } from '@mediforce/platform-api/contract';
import { mediforce, ApiError } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

import { CRITICAL_LIVE_INTERVAL_MS, STANDARD_LIVE_INTERVAL_MS, TERMINAL_STATUSES } from '@/lib/polling-cadence';

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
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
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
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
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
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
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
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
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
    refetchInterval: (q) => (q.state.error !== null ? false : CRITICAL_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
  });

  const activeTask = useMemo(
    () => (query.data ?? []).find((task) => !task.deleted) ?? null,
    [query.data],
  );

  return { task: activeTask, loading: enabled && query.isPending };
}

/**
 * Every human task (any status) raised against one step of a process
 * instance — powers the merged run-step page, which shows the actionable
 * task UI for waiting human steps. CRITICAL LIVE while the run is active so
 * claims by other users and L3 revise loops surface without a reload;
 * stops once the run is terminal. `instanceStatus === undefined` (not yet
 * known) is treated as active, mirroring `useStepExecutions`.
 */
export function useStepTasks(
  instanceId: string | null,
  stepId: string | null,
  instanceStatus: InstanceStatus | undefined,
): { tasks: HumanTask[]; loading: boolean } {
  const enabled =
    instanceId !== null && instanceId.length > 0 && stepId !== null && stepId.length > 0;
  const isTerminal = instanceStatus !== undefined && TERMINAL_STATUSES.has(instanceStatus);

  const query = useQuery({
    queryKey: enabled
      ? queryKeys.tasks.byInstance(instanceId, { stepId })
      : (['tasks', '__noop__'] as const),
    queryFn: async () => {
      if (instanceId === null || stepId === null) {
        throw new Error('unreachable: enabled gates this');
      }
      const result = await mediforce.tasks.list({ instanceId, stepId });
      return result.tasks;
    },
    enabled,
    refetchInterval: (q) => {
      if (q.state.error !== null) return false;
      return isTerminal ? false : CRITICAL_LIVE_INTERVAL_MS;
    },
    retry: stopRetryOn4xx,
  });

  const tasks = useMemo(
    () => (query.data ?? []).filter((task) => !task.deleted),
    [query.data],
  );

  return { tasks, loading: enabled && query.isPending };
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
    // Stop polling on any 4xx. 404 = no cowork session yet; the transition to
    // "session exists" originates from a UI mutation (`mediforce.cowork.create`
    // callsite) that invalidates this cache key. 403 = membership flipped.
    // Without the stop, every instance page without a session (or after a lost
    // membership) polls 40 req/min indefinitely.
    refetchInterval: (q) => {
      const err = q.state.error;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return CRITICAL_LIVE_INTERVAL_MS;
    },
    retry: stopRetryOn4xx,
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
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
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
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
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
