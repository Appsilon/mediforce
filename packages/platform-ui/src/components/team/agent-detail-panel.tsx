'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  X,
  Clock,
  TrendingUp,
  Target,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  MessageSquare,
  ExternalLink,
  ChevronRight,
  Cpu,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { AgentRun } from '@mediforce/platform-core';
import type { TeamAgent, AgentStatus } from './agent-team-sidebar';

function getAgentColor(pluginId: string | undefined): string {
  const id = (pluginId ?? '').toLowerCase();
  if (id.includes('claude')) return 'bg-violet-500';
  if (id.includes('opencode')) return 'bg-blue-500';
  if (id.includes('script')) return 'bg-slate-500';
  if (id.includes('risk') || id.includes('driver') || id.includes('supply'))
    return 'bg-emerald-500';
  return 'bg-primary';
}

function getInitials(name: string): string {
  return name
    .split(/[\s-_]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { label: string; className: string }> = {
    working: {
      label: 'Working',
      className: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
    },
    idle: {
      label: 'Idle',
      className: 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400',
    },
    attention: {
      label: 'Needs attention',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    },
    error: {
      label: 'Error',
      className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
    },
  };
  const c = config[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        c.className,
      )}
    >
      {c.label}
    </span>
  );
}

function AutonomyBadge({ level }: { level: string }) {
  const labels: Record<string, string> = {
    L0: 'Human-only',
    L1: 'Agent-assisted',
    L2: 'Human-in-the-loop',
    L3: 'Periodic review',
    L4: 'Fully autonomous',
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Zap className="h-3 w-3" />
      {level}
      <span className="hidden sm:inline"> — {labels[level] ?? level}</span>
    </span>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/50 px-3 py-3">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-lg font-semibold font-headline text-foreground">
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </span>
    </div>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'low_confidence':
    case 'escalated':
    case 'flagged':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function RunRow({ run, handle }: { run: AgentRun; handle: string }) {
  const confidence = run.envelope?.confidence;
  const confPct = confidence !== undefined && confidence !== null
    ? `${Math.round(confidence * 100)}%`
    : '--';
  const durationMs = run.envelope?.duration_ms ?? null;
  const durationLabel =
    durationMs !== null
      ? durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(1)}s`
      : '--';

  return (
    <Link
      href={`/${handle}/agents/${run.id}`}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
    >
      <RunStatusIcon status={run.status} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground truncate">
          {run.stepId}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {confPct}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {durationLabel}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>
    </Link>
  );
}

export function AgentDetailPanel({
  agent,
  agentRuns,
  handle,
  onClose,
}: {
  agent: TeamAgent;
  agentRuns: AgentRun[];
  handle: string;
  onClose: () => void;
}) {
  const def = agent.definition;
  const color = getAgentColor(def.pluginId);
  const initials = getInitials(def.name);

  // Stats
  const todayRuns = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return agentRuns.filter(
      (r) => new Date(r.startedAt).getTime() >= todayStart.getTime(),
    );
  }, [agentRuns]);

  const successRate = useMemo(() => {
    const finished = agentRuns.filter(
      (r) => r.status === 'completed' || r.status === 'error',
    );
    if (finished.length === 0) return '--';
    const succeeded = finished.filter((r) => r.status === 'completed').length;
    return `${Math.round((succeeded / finished.length) * 100)}%`;
  }, [agentRuns]);

  const avgConfidence = useMemo(() => {
    const withConfidence = agentRuns
      .map((r) => r.envelope?.confidence)
      .filter((c): c is number => c !== undefined && c !== null);
    if (withConfidence.length === 0) return '--';
    const avg = withConfidence.reduce((sum, c) => sum + c, 0) / withConfidence.length;
    return `${Math.round(avg * 100)}%`;
  }, [agentRuns]);

  const recentRuns = agentRuns.slice(0, 5);
  const runningRun = agentRuns.find((r) => r.status === 'running') ?? null;

  // Determine the latest autonomy level from runs
  const latestAutonomy = agentRuns[0]?.autonomyLevel ?? 'L1';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 px-5 pt-5 pb-4 border-b">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white',
                color,
              )}
            >
              {initials}
            </div>
            <div>
              <h2 className="text-base font-semibold font-headline text-foreground">
                {def.name}
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Cpu className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  {def.foundationModel || 'No model'}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hidden xl:flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={agent.status} />
          <AutonomyBadge level={latestAutonomy} />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Stats row */}
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="Today"
              value={String(todayRuns.length)}
              icon={Clock}
            />
            <StatCard
              label="Success"
              value={successRate}
              icon={TrendingUp}
            />
            <StatCard
              label="Confidence"
              value={avgConfidence}
              icon={Target}
            />
          </div>
        </div>

        {/* Current work */}
        {runningRun !== null && (
          <div className="px-5 pb-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Currently working on
            </h3>
            <div className="rounded-xl border border-green-200/50 dark:border-green-500/20 bg-green-50/50 dark:bg-green-500/5 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Loader2 className="h-3.5 w-3.5 text-green-500 animate-spin" />
                <span className="text-sm font-medium text-foreground">
                  {runningRun.stepId}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Started {formatDistanceToNow(new Date(runningRun.startedAt), { addSuffix: true })}
              </p>
              {runningRun.envelope?.reasoning_summary !== undefined &&
                runningRun.envelope.reasoning_summary !== '' && (
                  <p className="mt-2 text-[12px] text-muted-foreground line-clamp-3 leading-relaxed">
                    {runningRun.envelope.reasoning_summary}
                  </p>
                )}
            </div>
          </div>
        )}

        {/* Recent runs */}
        <div className="px-5 pb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Recent runs
          </h3>
          {recentRuns.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted mb-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-[12px] text-muted-foreground">No runs yet</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {recentRuns.map((run) => (
                <RunRow key={run.id} run={run} handle={handle} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="shrink-0 border-t px-5 py-4 space-y-2">
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium text-muted-foreground opacity-50 cursor-not-allowed transition-colors"
          title="Coming soon"
        >
          <MessageSquare className="h-4 w-4" />
          Chat with Agent
        </button>
        <Link
          href={`/${handle}/agents`}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          View all runs
        </Link>
      </div>
    </div>
  );
}
