'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Archive, FlaskConical, Lock } from 'lucide-react';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useMyActionableTasks } from '@/hooks/use-tasks';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { RunsTable } from '@/components/processes/runs-table';
import { formatStepName } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function RunsPage() {
  const { handle } = useParams<{ handle: string }>();
  const { role, loading: roleLoading } = useNamespaceRole(handle);

  if (roleLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (role === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Lock className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="font-medium">Runs are only visible to workspace members</p>
          <p className="text-sm text-muted-foreground mt-1">Join this workspace to see workflow runs.</p>
        </div>
        <Link href={`/${handle}`} className="text-sm text-primary hover:underline">
          Back to profile
        </Link>
      </div>
    );
  }

  return <RunsPageContent handle={handle} />;
}

function RunsPageContent({ handle }: { handle: string }) {
  const searchParams = useSearchParams();
  const workflowFilter = searchParams.get('workflow');
  const [showArchivedRuns, setShowArchivedRuns] = React.useState(false);
  const [dryRunFilter, setDryRunFilter] = React.useState<'all' | 'production' | 'dry-run'>('all');

  const { data: allInstances, loading } = useProcessInstances(
    'all',
    workflowFilter ?? undefined,
    showArchivedRuns,
    handle,
  );
  const { data: activeTasks } = useMyActionableTasks();

  const activeTaskByInstance = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const task of activeTasks) {
      if (!map.has(task.processInstanceId)) {
        map.set(task.processInstanceId, task.id);
      }
    }
    return map;
  }, [activeTasks]);

  const filtered = React.useMemo(() => {
    if (dryRunFilter === 'all') return allInstances;
    if (dryRunFilter === 'dry-run') return allInstances.filter((i) => i.dryRun === true);
    return allInstances.filter((i) => !i.dryRun);
  }, [allInstances, dryRunFilter]);

  const sorted = React.useMemo(
    () => [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [filtered],
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {workflowFilter ? 'All runs for this workflow.' : 'All workflow runs across the platform.'}
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border divide-x text-xs">
            {(['all', 'production', 'dry-run'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setDryRunFilter(value)}
                className={cn(
                  'px-2.5 py-1 transition-colors first:rounded-l-md last:rounded-r-md',
                  dryRunFilter === value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value === 'all' ? (
                  'All'
                ) : value === 'production' ? (
                  'Production'
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <FlaskConical className="h-3 w-3" />
                    Dry Runs
                  </span>
                )}
              </button>
            ))}
          </div>
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
      </div>

      {workflowFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Filtered by: <span className="font-medium text-foreground">{formatStepName(workflowFilter)}</span>
          </span>
          <a href={`/${handle}/runs`} className={cn('text-xs text-primary hover:underline')}>
            Clear filter
          </a>
        </div>
      )}

      <RunsTable
        runs={sorted}
        loading={loading}
        showProcess={!workflowFilter}
        activeTaskByInstance={activeTaskByInstance}
        emptyMessage={workflowFilter ? `No runs found for "${formatStepName(workflowFilter)}".` : 'No runs found.'}
      />
    </div>
  );
}
