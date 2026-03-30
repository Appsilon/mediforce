'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  XCircle,
  MessageSquare,
  Filter,
  Inbox,
  Clock,
  ArrowRight,
  RotateCcw,
  Eye,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { AgentRun, AgentDefinition, HumanTask } from '@mediforce/platform-core';

type FeedFilter = 'all' | 'attention' | 'active' | 'completed';

interface FeedEntry {
  id: string;
  type: 'completed' | 'working' | 'attention' | 'error';
  timestamp: string;
  agentName: string;
  agentInitials: string;
  agentColor: string;
  stepId: string;
  run?: AgentRun;
  task?: HumanTask;
}

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

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const variant =
    confidence >= 0.8
      ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
      : confidence >= 0.5
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
        : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        variant,
      )}
    >
      {pct}%
    </span>
  );
}

function SmallAvatar({ initials, color }: { initials: string; color: string }) {
  return (
    <div
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white',
        color,
      )}
    >
      {initials}
    </div>
  );
}

function CompletedCard({ entry, handle }: { entry: FeedEntry; handle: string }) {
  const run = entry.run;
  const confidence = run?.envelope?.confidence ?? null;
  const summary = run?.envelope?.reasoning_summary ?? null;

  return (
    <div className="group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-md hover:border-border/80">
      <div className="flex items-start gap-3">
        <SmallAvatar initials={entry.agentInitials} color={entry.agentColor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {entry.agentName}
            </span>
            <span className="text-sm text-muted-foreground">
              completed
            </span>
            <span className="text-sm font-medium text-foreground">
              {entry.stepId}
            </span>
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
          </div>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-muted-foreground/70">
              {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
            </span>
            {confidence !== null && <ConfidenceBadge confidence={confidence} />}
          </div>
          {summary !== null && summary !== '' && (
            <p className="mt-2 text-[13px] text-muted-foreground line-clamp-2 leading-relaxed">
              {summary}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {run !== undefined && (
              <Link
                href={`/${handle}/agents/${run.id}`}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-transparent hover:border-border"
              >
                <Eye className="h-3 w-3" />
                View details
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkingCard({ entry }: { entry: FeedEntry }) {
  const run = entry.run;
  const startedAt = run?.startedAt ?? entry.timestamp;
  const duration = formatDistanceToNow(new Date(startedAt));

  return (
    <div className="group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-md border-green-200/50 dark:border-green-500/20">
      <div className="flex items-start gap-3">
        <div className="relative">
          <SmallAvatar initials={entry.agentInitials} color={entry.agentColor} />
          <div className="absolute -bottom-0.5 -right-0.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {entry.agentName}
            </span>
            <span className="text-sm text-muted-foreground">
              is working on
            </span>
            <span className="text-sm font-medium text-foreground">
              {entry.stepId}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-green-600 dark:text-green-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>In progress</span>
            </div>
            <span className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {duration}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttentionCard({ entry, handle }: { entry: FeedEntry; handle: string }) {
  const task = entry.task;
  const reason = task?.creationReason ?? 'human_executor';
  const typeLabel =
    reason === 'agent_review_l3' ? 'Review' : 'Input';

  return (
    <div className="group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-md border-l-4 border-l-amber-500">
      <div className="flex items-start gap-3">
        <SmallAvatar initials={entry.agentInitials} color={entry.agentColor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {entry.agentName}
            </span>
            <span className="text-sm text-muted-foreground">
              needs your input on
            </span>
            <span className="text-sm font-medium text-foreground">
              {entry.stepId}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-muted-foreground/70">
              {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
            </span>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              {typeLabel}
            </span>
            {task?.deadline !== null && task?.deadline !== undefined && (
              <span className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Due {formatDistanceToNow(new Date(task.deadline), { addSuffix: true })}
              </span>
            )}
          </div>
          {task !== undefined && (
            <div className="mt-3">
              <Link
                href={`/${handle}/tasks/${task.id}`}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
              >
                Respond
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ entry, handle }: { entry: FeedEntry; handle: string }) {
  const run = entry.run;
  const errorMsg = run?.fallbackReason ?? 'An unexpected error occurred';

  return (
    <div className="group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-md border-l-4 border-l-red-500">
      <div className="flex items-start gap-3">
        <SmallAvatar initials={entry.agentInitials} color={entry.agentColor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {entry.agentName}
            </span>
            <span className="text-sm text-muted-foreground">
              encountered an error on
            </span>
            <span className="text-sm font-medium text-foreground">
              {entry.stepId}
            </span>
            <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
          </div>
          <p className="mt-1.5 text-[12px] text-red-600 dark:text-red-400 line-clamp-2">
            {errorMsg}
          </p>
          <div className="mt-1 text-[11px] text-muted-foreground/70">
            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            {run !== undefined && (
              <Link
                href={`/${handle}/agents/${run.id}`}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-transparent hover:border-border"
              >
                <Eye className="h-3 w-3" />
                View details
              </Link>
            )}
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-muted-foreground opacity-50 cursor-not-allowed"
              title="Retry coming soon"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-3/4 rounded bg-muted" />
              <div className="h-2.5 w-1/3 rounded bg-muted" />
              <div className="h-2.5 w-full rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const FILTER_PILLS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
];

export function ActivityFeed({
  runs,
  tasks,
  agents,
  loading,
  handle,
}: {
  runs: AgentRun[];
  tasks: HumanTask[];
  agents: AgentDefinition[];
  loading: boolean;
  handle: string;
}) {
  const [filter, setFilter] = useState<FeedFilter>('all');

  // Build agent lookup by pluginId and id
  const agentMap = useMemo(() => {
    const map = new Map<string, AgentDefinition>();
    for (const agent of agents) {
      map.set(agent.id, agent);
      if (agent.pluginId !== undefined) {
        map.set(agent.pluginId, agent);
      }
    }
    return map;
  }, [agents]);

  const resolveAgent = (pluginId: string): { name: string; initials: string; color: string } => {
    const def = agentMap.get(pluginId);
    if (def !== undefined) {
      return {
        name: def.name,
        initials: getInitials(def.name),
        color: getAgentColor(def.pluginId),
      };
    }
    return {
      name: pluginId,
      initials: getInitials(pluginId),
      color: getAgentColor(pluginId),
    };
  };

  const entries = useMemo((): FeedEntry[] => {
    const items: FeedEntry[] = [];

    // Add runs
    for (const run of runs) {
      const agent = resolveAgent(run.pluginId);
      let type: FeedEntry['type'];
      if (run.status === 'running') type = 'working';
      else if (run.status === 'error') type = 'error';
      else if (run.status === 'completed') type = 'completed';
      else continue; // skip other statuses in feed

      items.push({
        id: `run-${run.id}`,
        type,
        timestamp: run.completedAt ?? run.startedAt,
        agentName: agent.name,
        agentInitials: agent.initials,
        agentColor: agent.color,
        stepId: run.stepId,
        run,
      });
    }

    // Add pending tasks as attention entries
    const runProcessIds = new Set(runs.map((r) => r.processInstanceId));
    for (const task of tasks) {
      if (task.status !== 'pending') continue;

      // Find agent associated with this task's process
      const associatedRun = runs.find(
        (r) => r.processInstanceId === task.processInstanceId,
      );
      const agent = associatedRun !== undefined
        ? resolveAgent(associatedRun.pluginId)
        : { name: 'Agent', initials: 'AG', color: 'bg-primary' };

      // Skip if we already have a run-based entry for this
      if (!runProcessIds.has(task.processInstanceId) || associatedRun !== undefined) {
        items.push({
          id: `task-${task.id}`,
          type: 'attention',
          timestamp: task.createdAt,
          agentName: agent.name,
          agentInitials: agent.initials,
          agentColor: agent.color,
          stepId: task.stepId,
          task,
        });
      }
    }

    // Sort by timestamp descending
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, tasks, agentMap]);

  const filtered = useMemo(() => {
    if (filter === 'all') return entries;
    if (filter === 'attention') return entries.filter((e) => e.type === 'attention');
    if (filter === 'active') return entries.filter((e) => e.type === 'working');
    if (filter === 'completed') return entries.filter((e) => e.type === 'completed');
    return entries;
  }, [entries, filter]);

  const attentionCount = useMemo(
    () => entries.filter((e) => e.type === 'attention').length,
    [entries],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-headline font-semibold text-foreground">
            Mission Control
          </h1>
          {attentionCount > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
            </span>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
          {FILTER_PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              onClick={() => setFilter(pill.value)}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] font-medium transition-all duration-150',
                filter === pill.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {pill.label}
              {pill.value === 'attention' && attentionCount > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  {attentionCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <FeedSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
              <Inbox className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {filter === 'all' ? 'No activity yet' : `No ${filter} items`}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-[240px]">
              {filter === 'all'
                ? 'Agent activity and tasks will appear here as your workflows run.'
                : 'Try a different filter to see more activity.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => {
              switch (entry.type) {
                case 'completed':
                  return <CompletedCard key={entry.id} entry={entry} handle={handle} />;
                case 'working':
                  return <WorkingCard key={entry.id} entry={entry} />;
                case 'attention':
                  return <AttentionCard key={entry.id} entry={entry} handle={handle} />;
                case 'error':
                  return <ErrorCard key={entry.id} entry={entry} handle={handle} />;
                default:
                  return null;
              }
            })}
          </div>
        )}
      </div>

      {/* Message input — Phase 2 */}
      <div className="shrink-0 border-t px-6 py-3">
        <div
          className="group relative flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 cursor-not-allowed"
          title="Coming in Phase 2"
        >
          <MessageSquare className="h-4 w-4 text-muted-foreground/50" />
          <span className="text-sm text-muted-foreground/50">
            Message your team...
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/40 font-medium uppercase tracking-wider">
            Phase 2
          </span>
        </div>
      </div>
    </div>
  );
}
