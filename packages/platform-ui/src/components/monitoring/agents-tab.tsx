'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentRunListTable } from '@/components/agents/agent-run-list-table';
import type { AgentRun } from '@mediforce/platform-core';

interface Props {
  runs: AgentRun[];
  loading: boolean;
  processNameMap: Map<string, string>;
}

// Only statuses the AgentRunner ever actually assigns — see the comment on
// STATUS_STYLES in agent-run-list-table.tsx. AgentRunStatusSchema also
// declares `timed_out` / `low_confidence` / `error`, but those are never
// written to a real AgentRun (that detail lives on `fallbackReason`), so
// they're excluded here rather than offered as a filter that never matches.
const ALL_STATUSES = [
  'running',
  'completed',
  'escalated',
  'flagged',
  'paused',
  'interrupted',
] as const;

type CardKey = 'running' | 'completed' | 'error' | 'flagged';

// Same click-to-filter + hover pattern as the Workflows tab's KPI cards
// (workflows-tab.tsx) — pill colors match the corresponding status badges
// AgentRunListTable already renders, so a card and its filtered rows read
// as the same category.
const CARD_DEFS: Array<{ key: CardKey; label: string; pillClass: string; match: (run: AgentRun) => boolean }> = [
  {
    key: 'running',
    label: 'Running',
    pillClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    match: (r) => r.status === 'running',
  },
  {
    key: 'completed',
    label: 'Completed',
    pillClass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    match: (r) => r.status === 'completed',
  },
  {
    key: 'error',
    label: 'Errors',
    pillClass: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    // 'error'/'timed_out' are never real AgentRun.status values (see
    // agent-run-list-table.tsx) — that detail lives on fallbackReason.
    match: (r) => r.fallbackReason === 'error' || r.fallbackReason === 'timeout',
  },
  {
    key: 'flagged',
    label: 'Flagged / escalated',
    pillClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    match: (r) => r.status === 'escalated' || r.status === 'flagged',
  },
];

const TOTAL_PILL_CLASS = 'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-400';

export function AgentsTab({ runs, loading, processNameMap }: Props) {
  const [processFilter, setProcessFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [cardFilter, setCardFilter] = useState<CardKey | null>(null);

  const counts = useMemo(() => {
    const result: Record<CardKey, number> = { running: 0, completed: 0, error: 0, flagged: 0 };
    for (const def of CARD_DEFS) result[def.key] = runs.filter(def.match).length;
    return result;
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
      if (cardFilter) {
        const def = CARD_DEFS.find((d) => d.key === cardFilter);
        if (def && !def.match(run)) return false;
      }
      return true;
    });
  }, [runs, processFilter, statusFilter, cardFilter, processNameMap]);

  const cardFilterLabel = cardFilter ? CARD_DEFS.find((d) => d.key === cardFilter)?.label : null;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => setCardFilter(null)}
          className="rounded-lg border bg-card border-border p-4 space-y-1.5 text-left cursor-pointer transition-colors hover:border-primary/40"
        >
          {loading ? (
            <div className="h-8 w-12 rounded bg-muted animate-pulse" />
          ) : (
            <div className="text-3xl font-bold font-headline">{runs.length}</div>
          )}
          <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', TOTAL_PILL_CLASS)}>
            Total runs
          </span>
        </button>
        {CARD_DEFS.map((def) => (
          <button
            key={def.key}
            type="button"
            onClick={() => setCardFilter((prev) => (prev === def.key ? null : def.key))}
            className="rounded-lg border bg-card border-border p-4 space-y-1.5 text-left cursor-pointer transition-colors hover:border-primary/40"
          >
            {loading ? (
              <div className="h-8 w-12 rounded bg-muted animate-pulse" />
            ) : (
              <div className="text-3xl font-bold font-headline">{counts[def.key]}</div>
            )}
            <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', def.pillClass)}>
              {def.label}
            </span>
          </button>
        ))}
      </div>

      {/* Run history */}
      <section className="space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          {cardFilterLabel && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Filtered by: <span className="font-medium text-foreground">{cardFilterLabel}</span>
              <button
                onClick={() => setCardFilter(null)}
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
          )}

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
            {processFilter || statusFilter || cardFilter
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
