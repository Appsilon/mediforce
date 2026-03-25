'use client';

import { useMonitoringData } from '@/hooks/use-monitoring';
import { MonitoringSummaryCards } from '@/components/monitoring/monitoring-summary-cards';
import { StuckProcessesList } from '@/components/monitoring/stuck-processes-list';
import { AssignmentMap } from '@/components/monitoring/assignment-map';

export default function MonitoringPage() {
  const { statusCounts, stuckProcesses, roleCounts, loading } = useMonitoringData();

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-xl font-headline font-semibold">Monitoring</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Real-time view of all workflows and task assignments
        </p>
      </div>

      {/* Status summary */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Workflow Status
        </h2>
        <MonitoringSummaryCards
          running={statusCounts.running}
          paused={statusCounts.paused}
          failed={statusCounts.failed}
          completed={statusCounts.completed}
          loading={loading}
        />
      </section>

      {/* Two-column layout for stuck processes and assignment map */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Stuck Workflows
            </h2>
            {stuckProcesses.length > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {stuckProcesses.length} paused
              </span>
            )}
          </div>
          <StuckProcessesList processes={stuckProcesses} loading={loading} />
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
