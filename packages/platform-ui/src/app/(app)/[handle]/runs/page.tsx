'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Archive } from 'lucide-react';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useMyTasks } from '@/hooks/use-tasks';
import { RunsTable } from '@/components/processes/runs-table';
import { formatStepName } from '@/components/tasks/task-utils';
import { cn } from '@/lib/utils';

export default function RunsPage() {
  const { handle } = useParams<{ handle: string }>();
  const searchParams = useSearchParams();
  const workflowFilter = searchParams.get('workflow');
  const [showArchivedRuns, setShowArchivedRuns] = React.useState(false);

  const { data: allInstances, loading } = useProcessInstances(
    'all',
    workflowFilter ?? undefined,
    showArchivedRuns,
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
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {workflowFilter
            ? 'All runs for this workflow.'
            : 'All workflow runs across the platform.'}
        </p>
        <button
          onClick={() => setShowArchivedRuns((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
            showArchivedRuns
              ? 'border-primary text-primary bg-primary/5'
              : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
          )}
        >
          <Archive className="h-3.5 w-3.5" />
          {showArchivedRuns ? 'Hiding archived' : 'Show archived'}
        </button>
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
            href={`/${handle}/runs`}
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
