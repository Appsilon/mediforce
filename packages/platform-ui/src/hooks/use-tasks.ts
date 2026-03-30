'use client';

import { useMemo } from 'react';
import { where, orderBy } from 'firebase/firestore';
import type { HumanTask, CoworkSession } from '@mediforce/platform-core';
import { useCollection } from './use-collection';

export function useMyTasks(assignedRole: string | null) {
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
      return assignedRole
        ? notDeleted
        : notDeleted.filter((task) => task.status !== 'completed');
    },
    [data, assignedRole],
  );

  return { data: filtered, loading, error };
}

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

export function useAllTasks() {
  const constraints = useMemo(() => [orderBy('createdAt', 'desc')], []);
  const result = useCollection<HumanTask>('humanTasks', constraints);
  const data = useMemo(() => result.data.filter((task) => !task.deleted), [result.data]);
  return { ...result, data };
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
