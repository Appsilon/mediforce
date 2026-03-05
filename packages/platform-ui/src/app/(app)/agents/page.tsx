'use client';

import { useState, useMemo } from 'react';
import { useAgentRuns, useProcessNameMap } from '@/hooks/use-agent-runs';
import { AgentRunListTable } from '@/components/agents/agent-run-list-table';
import { StatCards } from '@/components/agents/stat-cards';

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

export default function AgentsPage() {
  const { data: runs, loading } = useAgentRuns();
  const processNameMap = useProcessNameMap();

  const [processFilter, setProcessFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Unique process names for the filter dropdown
  const processNames = useMemo(() => {
    const names = new Set<string>();
    for (const [, name] of processNameMap) {
      names.add(name);
    }
    return Array.from(names).sort();
  }, [processNameMap]);

  // Apply filters
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

  const subtitle = useMemo(() => {
    if (loading) return '\u2026';
    const hasFilter = processFilter || statusFilter;
    if (hasFilter) {
      return `Showing ${filteredRuns.length} of ${runs.length} agent runs`;
    }
    return `${runs.length} agent runs`;
  }, [loading, runs.length, filteredRuns.length, processFilter, statusFilter]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-headline font-semibold">Agent Oversight</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <select
          value={processFilter ?? ''}
          onChange={(e) => setProcessFilter(e.target.value || null)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">All Processes</option>
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
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Stat cards — always show unfiltered aggregate stats */}
      <StatCards runs={runs} loading={loading} />

      {/* Table — shows filtered runs */}
      <AgentRunListTable
        runs={filteredRuns}
        loading={loading}
        processNameMap={processNameMap}
      />
    </div>
  );
}
