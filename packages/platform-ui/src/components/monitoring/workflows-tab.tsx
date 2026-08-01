'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { WorkflowDisplayStatus } from '@/lib/workflow-status';
import { STATUS_LABELS, STATUS_STYLES } from '@/components/processes/process-status-badge';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useWorkflowStatusCounts } from '@/hooks/use-workflow-status-counts';
import { AllRunsPanel } from '@/components/processes/all-runs-panel';

// Only 4 of the 5 WorkflowDisplayStatus values get a KPI card — "cancelled"
// is deliberately left out per spec. Same order as the cards.
const CARD_STATUSES: WorkflowDisplayStatus[] = ['in_progress', 'waiting_for_human', 'error', 'completed'];

type DryRunFilter = 'all' | 'production' | 'dry-run';

export function WorkflowsTab() {
  const handle = useHandleFromPath();
  const [statusFilter, setStatusFilter] = useState<WorkflowDisplayStatus | null>(null);
  // Lifted out of AllRunsPanel (controlled props) so the KPI query below can
  // mirror them — a card's count must match what the table's own toggles
  // are currently showing, not a fixed unfiltered total.
  const [dryRunFilter, setDryRunFilter] = useState<DryRunFilter>('all');
  const [showArchivedRuns, setShowArchivedRuns] = useState(false);

  // Real SQL aggregation (COUNT(*) FILTER), not a client-side tally over a
  // fetched row set — see useWorkflowStatusCounts.
  const { counts, loading } = useWorkflowStatusCounts({
    namespace: handle,
    dryRun: dryRunFilter === 'all' ? undefined : dryRunFilter === 'dry-run',
    archived: showArchivedRuns,
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {CARD_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter((prev) => (prev === status ? null : status))}
            className="rounded-lg border bg-card border-border p-4 space-y-1.5 text-left cursor-pointer transition-colors hover:border-primary/40"
          >
            {loading ? (
              <div className="h-8 w-12 rounded bg-muted animate-pulse" />
            ) : (
              <div className="text-3xl font-bold font-headline">{counts[status]}</div>
            )}
            <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[status])}>
              {STATUS_LABELS[status]}
            </span>
          </button>
        ))}
      </div>

      <AllRunsPanel
        handle={handle}
        displayStatusFilter={statusFilter}
        onClearDisplayStatusFilter={() => setStatusFilter(null)}
        dryRunFilter={dryRunFilter}
        onDryRunFilterChange={setDryRunFilter}
        showArchivedRuns={showArchivedRuns}
        onShowArchivedRunsChange={setShowArchivedRuns}
      />
    </div>
  );
}
