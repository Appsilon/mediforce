'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { AgentRunListTable } from '@/components/agents/agent-run-list-table';
import type { AgentRun } from '@mediforce/platform-core';

interface Props {
  runs: AgentRun[];
  loading: boolean;
  processNameMap: Map<string, string>;
}

const ALL_STATUSES = [
  'running',
  'completed',
  'timed_out',
  'low_confidence',
  'error',
  'escalated',
  'flagged',
  'paused',
] as const;

export function AgentsTab({ runs, loading, processNameMap }: Props) {
  const [processFilter, setProcessFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const summary = useMemo(() => {
    const total = runs.length;
    const running = runs.filter((r) => r.status === 'running').length;
    const completed = runs.filter((r) => r.status === 'completed').length;
    const errors = runs.filter((r) => r.status === 'error' || r.status === 'timed_out').length;
    const flagged = runs.filter(
      (r) => r.status === 'escalated' || r.status === 'flagged' || r.status === 'low_confidence',
    ).length;
    return { total, running, completed, errors, flagged };
  }, [runs]);

  const processNames = useMemo(() => {
    // Drop empty / undefined definitionNames so the <select> doesn't end up
    // with multiple <option key=""> children — that collision is what
    // surfaces the "Each child in a list should have a unique key" warning
    // from React when a legacy ProcessInstance lacks its name.
    const names = new Set<string>();
    for (const [, name] of processNameMap) {
      if (typeof name === 'string' && name.length > 0) names.add(name);
    }
    return Array.from(names).sort();
  }, [processNameMap]);

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (processFilter) {
        const name = processNameMap.get(run.processInstanceId);
        if (name !== processFilter) return false;
      }
      if (statusFilter && run.status !== statusFilter) return false;
      return true;
    });
  }, [runs, processFilter, statusFilter, processNameMap]);

  const summaryCards = [
    { label: 'Total runs', value: summary.total, color: 'text-foreground' },
    { label: 'Running', value: summary.running, color: 'text-blue-600 dark:text-blue-400' },
    { label: 'Completed', value: summary.completed, color: 'text-green-600 dark:text-green-400' },
    { label: 'Errors', value: summary.errors, color: 'text-red-600 dark:text-red-400' },
    { label: 'Flagged / escalated', value: summary.flagged, color: 'text-amber-600 dark:text-amber-400' },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg border bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-48 rounded-lg border bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {summaryCards.map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border bg-card p-4 space-y-1">
            <div className={cn('text-3xl font-bold font-headline', color)}>{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {/* Run history */}
      <section className="space-y-3">
        <div className="flex gap-3 items-center">
          <select
            value={processFilter ?? ''}
            onChange={(e) => setProcessFilter(e.target.value || null)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option key="__all" value="">All Workflows</option>
            {processNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter(e.target.value || null)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option key="__all" value="">All Statuses</option>
            {ALL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          <span className="text-sm text-muted-foreground">
            {processFilter || statusFilter
              ? `${filteredRuns.length} of ${runs.length} runs`
              : `${runs.length} runs`}
          </span>
        </div>

        <AgentRunListTable
          runs={filteredRuns}
          loading={loading}
          processNameMap={processNameMap}
        />
      </section>
    </div>
  );
}
