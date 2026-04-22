'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { StepExecution } from '@mediforce/platform-core';
import { useInstanceTasks } from '@/hooks/use-instance-tasks';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';

function statusBadgeClass(status: string) {
  if (status === 'completed') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
  if (status === 'failed') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  return 'bg-muted text-muted-foreground';
}

export function StepHistoryTabs({ steps, loading, processInstanceId }: { steps: StepExecution[]; loading: boolean; processInstanceId?: string }) {
  const handle = useHandleFromPath();

  // Historical view — one-shot read through the typed apiClient is enough;
  // the realtime equivalent (useCollection) is overkill here.
  const { tasks } = useInstanceTasks(processInstanceId);

  const taskByStepId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (task.deleted !== true) {
        map.set(task.stepId, task.id);
      }
    }
    return map;
  }, [tasks]);

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />)}</div>;
  }

  if (steps.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No step history yet</div>;
  }

  const sorted = [...steps].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const seenStepIds = new Set<string>();

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {['Step', 'Status', 'Started', 'Completed', 'Executed By'].map((h) => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((step) => {
            const isFirstOccurrence = !seenStepIds.has(step.stepId);
            seenStepIds.add(step.stepId);
            const taskId = taskByStepId.get(step.stepId);
            return (
              <tr
                key={step.id}
                className="hover:bg-muted/20"
                data-step-id={step.stepId}
                {...(isFirstOccurrence ? { id: `step-history-${step.stepId}` } : {})}
              >
                <td className="px-4 py-2.5 font-mono text-xs">
                  {taskId ? (
                    <Link href={routes.task(handle, taskId)} className="text-primary hover:underline">
                      {step.stepId}
                    </Link>
                  ) : (
                    step.stepId
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn('capitalize text-xs rounded-full px-2 py-0.5', statusBadgeClass(step.status))}>
                    {step.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{format(new Date(step.startedAt), 'MMM d, HH:mm')}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{step.completedAt ? format(new Date(step.completedAt), 'MMM d, HH:mm') : '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{step.executedBy}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
