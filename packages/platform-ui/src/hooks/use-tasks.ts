'use client';

import { useMemo } from 'react';
import { where, orderBy } from 'firebase/firestore';
import type { HumanTask } from '@mediforce/platform-core';
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
    () =>
      assignedRole
        ? data
        : data.filter((task) => task.status !== 'completed'),
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
    () =>
      assignedRole
        ? data
        : data.filter((task) => task.status === 'completed'),
    [data, assignedRole],
  );

  return { data: filtered, loading, error };
}

export function useAllTasks() {
  const constraints = useMemo(() => [orderBy('createdAt', 'desc')], []);
  return useCollection<HumanTask>('humanTasks', constraints);
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

  return { task: data[0] ?? null, loading };
}
