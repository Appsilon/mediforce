'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useMonitoringSummary } from '@/hooks/use-monitoring';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { MonitoringSummaryCards } from '@/components/monitoring/monitoring-summary-cards';
import { StuckProcessesList } from '@/components/monitoring/stuck-processes-list';
import { AssignmentMap } from '@/components/monitoring/assignment-map';

export default function MonitoringPage() {
  const { handle } = useParams<{ handle: string }>();
  const { data: summary, loading } = useMonitoringSummary(handle);

  // Paused-instance list lives in the processes domain — it stays on the
  // Firestore-backed `useProcessInstances` hook until that domain's
  // react-query migration lands. Counts come from the headless aggregate.
  const { data: pausedInstances, loading: pausedLoading } = useProcessInstances(
    'paused',
    undefined,
    false,
    handle,
  );

  const runs = summary?.runs;
  const roleCounts = useMemo(() => {
    const entries = Object.entries(summary?.roleTaskCounts ?? {});
    return entries
      .map(([role, counts]) => ({
        role,
        pending: counts.pending,
        claimed: counts.claimed,
        total: counts.pending + counts.claimed,
      }))
      .sort((a, b) => b.total - a.total);
  }, [summary]);

  return (
    <div className="p-6 space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          Real-time view of all workflows and task assignments
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Workflow Status
        </h2>
        <MonitoringSummaryCards
          running={runs?.running ?? 0}
          paused={runs?.paused ?? 0}
          failed={runs?.failed ?? 0}
          completed={runs?.completed ?? 0}
          loading={loading}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Stuck Workflows
            </h2>
            {pausedInstances.length > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {pausedInstances.length} paused
              </span>
            )}
          </div>
          <StuckProcessesList processes={pausedInstances} loading={pausedLoading} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Task Assignments by Role
          </h2>
          <AssignmentMap roleCounts={roleCounts} loading={loading} />
        </section>
      </div>
    </div>
  );
}
