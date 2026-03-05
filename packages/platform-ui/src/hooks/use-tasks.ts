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
        : [],
    [assignedRole],
  );
  return useCollection<HumanTask>('humanTasks', constraints);
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
        : [],
    [assignedRole],
  );
  return useCollection<HumanTask>('humanTasks', constraints);
}

export function useAllTasks() {
  const constraints = useMemo(() => [orderBy('createdAt', 'desc')], []);
  return useCollection<HumanTask>('humanTasks', constraints);
}
