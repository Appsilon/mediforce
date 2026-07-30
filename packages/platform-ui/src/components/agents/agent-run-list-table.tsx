'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format, differenceInMilliseconds } from 'date-fns';
import { Bot, Cpu, Terminal, BarChart3 } from 'lucide-react';
import type { AgentRun } from '@mediforce/platform-core';
import { ControlModeBadge } from '@/components/ui/control-mode-badge';
import { AgentLogPanel } from './agent-log-panel';

import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useModelPricing } from '@/hooks/use-model-registry';
import { routes } from '@/lib/routes';
import { formatAgentRunCost } from '@/lib/agent-cost';
import { formatAgentRunContainer } from '@/lib/agent-container';
import { useStepAllowedTools } from '@/hooks/use-step-permissions';
import type { LucideIcon } from 'lucide-react';

function getPluginDisplay(pluginId: string): { Icon: LucideIcon; colorClass: string; label: string } {
  const id = pluginId.toLowerCase();
  if (id.includes('claude')) return { Icon: Bot, colorClass: 'text-violet-500', label: pluginId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  if (id.includes('opencode')) return { Icon: Cpu, colorClass: 'text-blue-500', label: pluginId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  if (id.includes('script')) return { Icon: Terminal, colorClass: 'text-slate-500', label: pluginId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  if (id.includes('risk') || id.includes('driver') || id.includes('supply')) return { Icon: BarChart3, colorClass: 'text-emerald-500', label: pluginId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  return { Icon: Bot, colorClass: 'text-primary', label: pluginId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
}

/**
 * Only the statuses the AgentRunner ever actually assigns (agent-runner.ts +
 * fallback-handler.ts). AgentRunStatusSchema also declares `timed_out`,
 * `low_confidence`, and `error` — those are never written to a real
 * AgentRun; that information lives on `fallbackReason` instead. Styling
 * them here would present statuses that can't occur.
 */
const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  escalated: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  flagged: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  paused: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  interrupted: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function PermissionsCell({ run }: { run: AgentRun }) {
  const { data: allowedTools, loading } = useStepAllowedTools(run.processInstanceId, run.stepId);
  if (loading) return <span className="text-xs text-muted-foreground">…</span>;
  if (allowedTools === undefined || allowedTools.length === 0) {
    return <span className="text-xs text-muted-foreground">no data</span>;
  }
  return <span className="text-xs text-muted-foreground">{allowedTools.join(', ')}</span>;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = differenceInMilliseconds(new Date(end), new Date(start));
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 11 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-muted animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function AgentRunListTable({
  runs,
  loading,
  processNameMap,
}: {
  runs: AgentRun[];
  loading: boolean;
  processNameMap?: Map<string, string>;
}) {
  const handle = useHandleFromPath();
  const modelPricing = useModelPricing();
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  return (
    <>
      <div className="rounded-md border overflow-clip">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b bg-muted text-xs text-muted-foreground">
              {['Model', 'Plugin', 'Container', 'Workflow Run', 'Control Mode', 'Permissions', 'Cost', 'Duration', 'Started', 'Status', 'Log'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              : runs.length === 0
              ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No agent runs yet. Agent runs appear here once the AgentRunner executes with a repository configured.
                  </td>
                </tr>
              )
              : runs.map((run) => {
                const workflowName = processNameMap?.get(run.processInstanceId);
                return (
                  <tr key={run.id} className="border-b last:border-0 transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {run.envelope?.model ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const { Icon, colorClass, label } = getPluginDisplay(run.pluginId);
                        return (
                          <Link href={routes.agent(handle, run.id)} className="inline-flex items-center gap-1.5 font-medium text-xs hover:text-primary transition-colors">
                            <Icon className={cn('h-3.5 w-3.5 shrink-0', colorClass)} />
                            {label}
                          </Link>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatAgentRunContainer(run)}
                    </td>
                    <td className="px-4 py-3">
                      {workflowName ? (
                        <Link
                          href={routes.workflowRun(handle, workflowName, run.processInstanceId)}
                          className="text-xs text-muted-foreground hover:text-primary transition-colors"
                        >
                          {workflowName}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {`${run.processInstanceId.slice(0, 8)}...`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ControlModeBadge executor="agent" autonomyLevel={run.autonomyLevel} />
                    </td>
                    <td className="px-4 py-3">
                      <PermissionsCell run={run} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                      {formatAgentRunCost(run, modelPricing)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDuration(run.startedAt, run.completedAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {format(new Date(run.startedAt), 'MMM d, HH:mm')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[run.status] ?? STATUS_STYLES.paused)}>
                        {run.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedRun(run)}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <AgentLogPanel run={selectedRun} onClose={() => setSelectedRun(null)} />
    </>
  );
}
