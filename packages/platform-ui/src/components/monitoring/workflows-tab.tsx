'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { MonitoringSummaryCards } from './monitoring-summary-cards';
import type { MonitoringData } from '@/hooks/use-monitoring';
import type { ProcessInstance } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { getWorkflowStatus } from '@/lib/workflow-status';

interface Props {
  data: MonitoringData;
}

const PAGE_SIZE = 10;

const STATUS_STYLE: Record<string, string> = {
  running: 'text-foreground',
  paused: 'text-amber-600 dark:text-amber-400',
  failed: 'text-red-600 dark:text-red-400',
  completed: 'text-green-600 dark:text-green-400',
  created: 'text-blue-600 dark:text-blue-400',
};

function StuckItem({ inst, handle }: { inst: ProcessInstance; handle: string }) {
  const wfStatus = getWorkflowStatus(inst);
  const displayReason =
    wfStatus.reason !== null && wfStatus.reason.length > 120
      ? wfStatus.reason.slice(0, 120) + '…'
      : wfStatus.reason;

  return (
    <div className="flex items-start gap-3 rounded-md border bg-card p-3">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <Link
            href={`/${handle}/workflows/${inst.id}`}
            className="font-medium text-sm hover:text-primary transition-colors truncate"
          >
            {inst.definitionName}
          </Link>
          <span className="text-xs text-muted-foreground shrink-0">
            stuck {formatDistanceToNow(new Date(inst.updatedAt), { addSuffix: true })}
          </span>
        </div>
        {displayReason && (
          <div className="text-xs text-amber-700 dark:text-amber-300">{displayReason}</div>
        )}
        {inst.currentStepId && (
          <div className="text-xs text-muted-foreground font-mono">at: {inst.currentStepId}</div>
        )}
      </div>
    </div>
  );
}

function ErrorItem({ inst }: { inst: ProcessInstance }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{inst.definitionName}</span>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
          {inst.status}
        </span>
      </div>
      {inst.currentStepId && (
        <p className="text-xs text-muted-foreground font-mono mt-1">at: {inst.currentStepId}</p>
      )}
    </div>
  );
}

interface PaginatedListProps {
  count: number;
  total: number;
  onLoadMore: () => void;
  empty: React.ReactNode;
  children: React.ReactNode;
}

function PaginatedScrollList({ count, total, onLoadMore, empty, children }: PaginatedListProps) {
  if (total === 0) return <>{empty}</>;
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="max-h-[360px] overflow-y-auto p-3 space-y-2">
        {children}
        {count < total && (
          <button
            onClick={onLoadMore}
            className="w-full mt-1 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-dashed rounded-md hover:bg-muted/40 transition-colors"
          >
            Load more ({total - count} remaining)
          </button>
        )}
      </div>
    </div>
  );
}

export function WorkflowsTab({ data }: Props) {
  const { statusCounts, stuckProcesses, instances, loading } = data;
  const handle = useHandleFromPath();
  const [stuckVisible, setStuckVisible] = useState(PAGE_SIZE);
  const [errorsVisible, setErrorsVisible] = useState(PAGE_SIZE);

  const failedInstances = useMemo(
    () => instances.filter((i) => i.status === 'failed'),
    [instances],
  );

  const perWorkflow = useMemo(() => {
    const map = new Map<
      string,
      { name: string; running: number; paused: number; failed: number; completed: number; total: number }
    >();
    for (const inst of instances) {
      const entry = map.get(inst.definitionName) ?? {
        name: inst.definitionName,
        running: 0,
        paused: 0,
        failed: 0,
        completed: 0,
        total: 0,
      };
      entry.total++;
      if (inst.status === 'running') entry.running++;
      else if (inst.status === 'paused') entry.paused++;
      else if (inst.status === 'failed') entry.failed++;
      else if (inst.status === 'completed') entry.completed++;
      map.set(inst.definitionName, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [instances]);

  return (
    <div className="space-y-8">
      {/* Stuck workflows + Top errors — top of tab */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Stuck workflows
            </h2>
            {stuckProcesses.length > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {stuckProcesses.length} paused
              </span>
            )}
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <PaginatedScrollList
              count={Math.min(stuckVisible, stuckProcesses.length)}
              total={stuckProcesses.length}
              onLoadMore={() => setStuckVisible((v) => v + PAGE_SIZE)}
              empty={
                <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
                  No stuck workflows — all workflows are advancing normally.
                </div>
              }
            >
              {stuckProcesses.slice(0, stuckVisible).map((inst) => (
                <StuckItem key={inst.id} inst={inst} handle={handle} />
              ))}
            </PaginatedScrollList>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Top errors
            </h2>
            {failedInstances.length > 0 && (
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                {failedInstances.length} failed
              </span>
            )}
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <PaginatedScrollList
              count={Math.min(errorsVisible, failedInstances.length)}
              total={failedInstances.length}
              onLoadMore={() => setErrorsVisible((v) => v + PAGE_SIZE)}
              empty={
                <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
                  No errors — all runs completed or are in progress.
                </div>
              }
            >
              {failedInstances.slice(0, errorsVisible).map((inst) => (
                <ErrorItem key={inst.id} inst={inst} />
              ))}
            </PaginatedScrollList>
          )}
        </section>
      </div>

      {/* Status cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Status overview
        </h2>
        <MonitoringSummaryCards
          running={statusCounts.running}
          paused={statusCounts.paused}
          failed={statusCounts.failed}
          completed={statusCounts.completed}
          loading={loading}
        />
      </section>

      {/* Per-workflow breakdown */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Runs by workflow
        </h2>
        {loading ? (
          <div className="h-32 rounded-lg border bg-muted animate-pulse" />
        ) : perWorkflow.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workflow runs yet.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Workflow</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Running</th>
                  <th className="px-4 py-2 text-right font-medium">Paused</th>
                  <th className="px-4 py-2 text-right font-medium">Failed</th>
                  <th className="px-4 py-2 text-right font-medium">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {perWorkflow.map((wf) => (
                  <tr key={wf.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{wf.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{wf.total}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', STATUS_STYLE.running)}>
                      {wf.running || '—'}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', STATUS_STYLE.paused)}>
                      {wf.paused || '—'}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', wf.failed > 0 ? STATUS_STYLE.failed : '')}>
                      {wf.failed || '—'}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', STATUS_STYLE.completed)}>
                      {wf.completed || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
