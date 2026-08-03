'use client';

import * as React from 'react';
import { Archive, FlaskConical, X } from 'lucide-react';
import { useProcessInstancesPage } from '@/hooks/use-process-instances-page';
import { useMyActionableTasks } from '@/hooks/use-tasks';
import { RunsTable } from './runs-table';
import { STATUS_LABELS } from './process-status-badge';
import { type DryRunFilter, dryRunFilterToQuery } from './dry-run-filter';
import type { WorkflowDisplayStatus } from '@/lib/workflow-status';
import { formatStepName } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The "All runs" table + its filters (production/dry-run, archived toggle,
 * and an optional display-status filter driven by Monitoring → Workflows'
 * KPI cards) — shared between the standalone `/runs` page (optionally
 * scoped to one workflow via `workflowFilter`, deep-linked from the
 * workflow catalog's "Show all runs" cards) and Monitoring → Workflows
 * (always unscoped).
 */
export function AllRunsPanel({
  handle,
  workflowFilter,
  displayStatusFilter,
  onClearDisplayStatusFilter,
  dryRunFilter: controlledDryRunFilter,
  onDryRunFilterChange,
  showArchivedRuns: controlledShowArchivedRuns,
  onShowArchivedRunsChange,
}: {
  handle: string;
  workflowFilter?: string | null;
  /** getWorkflowStatus().displayStatus to narrow to — e.g. clicking a KPI
   *  card in Monitoring → Workflows. Not a control this panel owns itself. */
  displayStatusFilter?: WorkflowDisplayStatus | null;
  /** Shows a "Filtered by: <status> · Clear" chip when displayStatusFilter
   *  is set, so clearing doesn't require scrolling back up to the card. */
  onClearDisplayStatusFilter?: () => void;
  /**
   * Controlled/uncontrolled pair, same convention for both toggles: pass
   * both the value and its setter to lift state to the parent (Monitoring
   * → Workflows mirrors these into its KPI-count query, so a card's number
   * matches what the table's own toggles are currently showing); omit both
   * to keep this panel's own internal state (the standalone `/runs` page,
   * which has no KPI cards to keep in sync).
   */
  dryRunFilter?: DryRunFilter;
  onDryRunFilterChange?: (value: DryRunFilter) => void;
  showArchivedRuns?: boolean;
  onShowArchivedRunsChange?: (value: boolean) => void;
}) {
  const [internalShowArchivedRuns, setInternalShowArchivedRuns] = React.useState(false);
  const [internalDryRunFilter, setInternalDryRunFilter] = React.useState<DryRunFilter>('all');
  const showArchivedRuns = controlledShowArchivedRuns ?? internalShowArchivedRuns;
  const setShowArchivedRuns = onShowArchivedRunsChange ?? setInternalShowArchivedRuns;
  const dryRunFilter = controlledDryRunFilter ?? internalDryRunFilter;
  const setDryRunFilter = onDryRunFilterChange ?? setInternalDryRunFilter;

  const { data: sorted, loading, hasMore, loadingMore, loadMore } = useProcessInstancesPage({
    namespace: handle,
    workflowFilter: workflowFilter ?? undefined,
    dryRun: dryRunFilterToQuery(dryRunFilter),
    archived: showArchivedRuns,
    displayStatus: displayStatusFilter,
  });
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        {displayStatusFilter ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Filtered by:{' '}
            <span className="font-medium text-foreground">{STATUS_LABELS[displayStatusFilter]}</span>
            {onClearDisplayStatusFilter && (
              <button
                onClick={onClearDisplayStatusFilter}
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
        ) : (
          <span />
        )}
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
              {value === 'all' ? 'All' : value === 'production' ? 'Production' : (
                <span className="inline-flex items-center gap-1">
                  <FlaskConical className="h-3 w-3" />Dry Runs
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowArchivedRuns(!showArchivedRuns)}
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
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
