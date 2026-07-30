'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { getWorkflowStatus, type WorkflowDisplayStatus } from '@/lib/workflow-status';
import { STATUS_LABELS, STATUS_STYLES } from '@/components/processes/process-status-badge';
import type { MonitoringData } from '@/hooks/use-monitoring';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { AllRunsPanel } from '@/components/processes/all-runs-panel';

interface Props {
  data: MonitoringData;
}

// Only 4 of the 5 WorkflowDisplayStatus values get a KPI card — "cancelled"
// is deliberately left out per spec. Same order as the cards.
const CARD_STATUSES: WorkflowDisplayStatus[] = ['in_progress', 'waiting_for_human', 'error', 'completed'];

export function WorkflowsTab({ data }: Props) {
  const { instances, loading } = data;
  const handle = useHandleFromPath();
  const [statusFilter, setStatusFilter] = useState<WorkflowDisplayStatus | null>(null);

  // Same instances AllRunsPanel renders by default (identical query key —
  // useProcessInstances('all', undefined, false, handle) in both places, so
  // they dedupe to one request) run through the same getWorkflowStatus the
  // table's badges use — the counts can't drift from what's actually shown.
  const counts = useMemo(() => {
    const result: Partial<Record<WorkflowDisplayStatus, number>> = {};
    for (const instance of instances) {
      const { displayStatus } = getWorkflowStatus(instance);
      result[displayStatus] = (result[displayStatus] ?? 0) + 1;
    }
    return result;
  }, [instances]);

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
              <div className="text-3xl font-bold font-headline">{counts[status] ?? 0}</div>
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
      />
    </div>
  );
}
