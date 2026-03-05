'use client';

import { orderBy, where } from 'firebase/firestore';
import { useMemo } from 'react';
import type { ProcessInstance, HumanTask } from '@mediforce/platform-core';
import { useCollection } from './use-collection';

export interface MonitoringData {
  statusCounts: {
    running: number;
    paused: number;
    failed: number;
    completed: number;
    created: number;
  };
  stuckProcesses: ProcessInstance[]; // paused instances, sorted oldest first
  roleCounts: Array<{ role: string; pending: number; claimed: number; total: number }>;
  loading: boolean;
}

export function useMonitoringData(): MonitoringData {
  const instanceConstraints = useMemo(() => [orderBy('createdAt', 'desc')], []);
  const { data: instances, loading: instancesLoading } = useCollection<ProcessInstance>(
    'processInstances',
    instanceConstraints,
  );

  const taskConstraints = useMemo(
    () => [where('status', 'in', ['pending', 'claimed']), orderBy('createdAt', 'asc')],
    [],
  );
  const { data: tasks, loading: tasksLoading } = useCollection<HumanTask>(
    'humanTasks',
    taskConstraints,
  );

  const statusCounts = useMemo(() => {
    const counts = { running: 0, paused: 0, failed: 0, completed: 0, created: 0 };
    for (const inst of instances) {
      if (inst.status in counts) {
        counts[inst.status as keyof typeof counts]++;
      }
    }
    return counts;
  }, [instances]);

  const stuckProcesses = useMemo(
    () =>
      instances
        .filter((i) => i.status === 'paused')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [instances],
  );

  const roleCounts = useMemo(() => {
    const map = new Map<string, { pending: number; claimed: number }>();
    for (const task of tasks) {
      const entry = map.get(task.assignedRole) ?? { pending: 0, claimed: 0 };
      if (task.status === 'pending') entry.pending++;
      if (task.status === 'claimed') entry.claimed++;
      map.set(task.assignedRole, entry);
    }
    return Array.from(map.entries())
      .map(([role, counts]) => ({ role, ...counts, total: counts.pending + counts.claimed }))
      .sort((a, b) => b.total - a.total);
  }, [tasks]);

  return {
    statusCounts,
    stuckProcesses,
    roleCounts,
    loading: instancesLoading || tasksLoading,
  };
}
