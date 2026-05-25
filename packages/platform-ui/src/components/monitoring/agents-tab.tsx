'use client';

import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentRun } from '@mediforce/platform-core';

interface Props {
  runs: AgentRun[];
  loading: boolean;
  processNameMap: Map<string, string>;
}

const STATUS_STYLE: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  timed_out: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  low_confidence: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  escalated: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  flagged: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  paused: 'bg-muted text-muted-foreground',
};

function duration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function AgentsTab({ runs, loading, processNameMap }: Props) {
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

  const perAgent = useMemo(() => {
    const map = new Map<
      string,
      { runs: number; errors: number; lastRun: string; pluginId: string }
    >();
    for (const run of runs) {
      const entry = map.get(run.pluginId) ?? { runs: 0, errors: 0, lastRun: run.startedAt, pluginId: run.pluginId };
      entry.runs++;
      if (run.status === 'error' || run.status === 'timed_out') entry.errors++;
      if (run.startedAt > entry.lastRun) entry.lastRun = run.startedAt;
      map.set(run.pluginId, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.runs - a.runs);
  }, [runs]);

  const recentErrors = useMemo(
    () =>
      runs
        .filter((r) => r.status === 'error' || r.status === 'timed_out')
        .slice(0, 10),
    [runs],
  );

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
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {summaryCards.map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border bg-card p-4 space-y-1">
            <div className={cn('text-3xl font-bold font-headline', color)}>{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {/* Per-agent breakdown */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          By agent
        </h2>
        {perAgent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agent runs recorded yet.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Agent (plugin ID)</th>
                  <th className="px-4 py-2 text-right font-medium">Runs</th>
                  <th className="px-4 py-2 text-right font-medium">Errors</th>
                  <th className="px-4 py-2 text-right font-medium">Error rate</th>
                  <th className="px-4 py-2 text-left font-medium">Last run</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {perAgent.map((agent) => (
                  <tr key={agent.pluginId} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs font-medium">{agent.pluginId}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{agent.runs}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span
                        className={cn(agent.errors > 0 && 'text-red-600 dark:text-red-400 font-semibold')}
                      >
                        {agent.errors}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {agent.runs > 0 ? `${Math.round((agent.errors / agent.runs) * 100)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(agent.lastRun), { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent run history */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Agent</th>
                  <th className="px-4 py-2 text-left font-medium">Step</th>
                  <th className="px-4 py-2 text-left font-medium">Workflow</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Duration</th>
                  <th className="px-4 py-2 text-left font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.slice(0, 20).map((run) => (
                  <tr key={run.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs">{run.pluginId}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {run.stepId}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {processNameMap.get(run.processInstanceId) ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          STATUS_STYLE[run.status] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {run.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                      {duration(run.startedAt, run.completedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Errors */}
      {recentErrors.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Recent errors
            </h2>
          </div>
          <div className="space-y-2">
            {recentErrors.map((run) => (
              <div
                key={run.id}
                className="rounded-md border bg-card px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-medium">{run.pluginId}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-xs text-muted-foreground">{run.stepId}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                  </span>
                </div>
                {run.fallbackReason && (
                  <p className="text-xs text-red-700 dark:text-red-300">{run.fallbackReason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Workflow: {processNameMap.get(run.processInstanceId) ?? run.processInstanceId}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground/60 italic">
        Tool-level telemetry (MCP calls, WebSearch, file access) will appear here once the agent
        runtime emits per-tool events.
      </p>
    </div>
  );
}
