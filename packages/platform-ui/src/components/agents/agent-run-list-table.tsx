'use client';

import Link from 'next/link';
import { format, differenceInMilliseconds } from 'date-fns';
import type { AgentRun } from '@mediforce/platform-core';
import { ConfidenceBadge } from './confidence-badge';
import { AutonomyBadge } from './autonomy-badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  escalated: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  timed_out: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  low_confidence: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  flagged: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  paused: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = differenceInMilliseconds(new Date(end), new Date(start));
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
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
  return (
    <div className="rounded-md border overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {['Agent', 'Autonomy', 'Process', 'Status', 'Confidence', 'Model', 'Duration', 'Started'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            : runs.length === 0
            ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No agent runs yet. Agent runs appear here once the AgentRunner executes with a repository configured.
                </td>
              </tr>
            )
            : runs.map((run) => (
              <tr key={run.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/agents/${run.id}`} className="font-medium font-mono text-xs hover:text-primary transition-colors">
                    {run.pluginId}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <AutonomyBadge level={run.autonomyLevel} />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/processes/${run.processInstanceId}`} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                    {processNameMap?.get(run.processInstanceId) ?? `${run.processInstanceId.slice(0, 8)}...`}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[run.status] ?? STATUS_STYLES.paused)}>
                    {run.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ConfidenceBadge confidence={run.envelope?.confidence} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {run.envelope?.model ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDuration(run.startedAt, run.completedAt)}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {format(new Date(run.startedAt), 'MMM d, HH:mm')}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
