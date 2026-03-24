'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useMyTasks } from '@/hooks/use-tasks';
import { RunsTable } from '@/components/processes/runs-table';
import { formatStepName } from '@/components/tasks/task-utils';
import { cn } from '@/lib/utils';

export default function RunsPage() {
  const searchParams = useSearchParams();
  const workflowFilter = searchParams.get('workflow');

  const { data: allInstances, loading } = useProcessInstances(
    'all',
    workflowFilter ?? undefined,
  );
  const { data: activeTasks } = useMyTasks(null);

  const activeTaskByInstance = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const task of activeTasks) {
      if (!map.has(task.processInstanceId)) {
        map.set(task.processInstanceId, task.id);
      }
    }
    return map;
  }, [activeTasks]);

  const sorted = React.useMemo(
    () =>
      [...allInstances].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [allInstances],
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-headline font-semibold">
          {workflowFilter
            ? `Runs — ${formatStepName(workflowFilter)}`
            : 'All Runs'}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {workflowFilter
            ? 'All runs for this workflow.'
            : 'All workflow runs across the platform.'}
        </p>
      </div>

      {workflowFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Filtered by:{' '}
            <span className="font-medium text-foreground">
              {formatStepName(workflowFilter)}
            </span>
          </span>
          <a
            href="/runs"
            className={cn(
              'text-xs text-primary hover:underline',
            )}
          >
            Clear filter
          </a>
        </div>
      )}

      <RunsTable
        runs={sorted}
        loading={loading}
        showProcess={!workflowFilter}
        activeTaskByInstance={activeTaskByInstance}
        emptyMessage={
          workflowFilter
            ? `No runs found for "${formatStepName(workflowFilter)}".`
            : 'No runs found.'
        }
      />
    </div>
  );
}
