'use client';

import { useMemo } from 'react';
import { Users, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentRun, AgentDefinition, HumanTask } from '@mediforce/platform-core';

export type AgentStatus = 'working' | 'idle' | 'attention' | 'error';

export interface TeamAgent {
  definition: AgentDefinition;
  status: AgentStatus;
  currentTask: string | null;
  pendingCount: number;
  latestRun: AgentRun | null;
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

function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {(status === 'working' || status === 'attention') && (
        <span
          className={cn(
            'absolute inset-0 rounded-full animate-ping opacity-40',
            status === 'working' ? 'bg-green-500' : 'bg-amber-500',
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex h-2.5 w-2.5 rounded-full',
          status === 'working' && 'bg-green-500',
          status === 'idle' && 'bg-gray-400 dark:bg-gray-500',
          status === 'attention' && 'bg-amber-500',
          status === 'error' && 'bg-red-500',
        )}
      />
    </span>
  );
}

function AgentRow({
  agent,
  selected,
  onSelect,
}: {
  agent: TeamAgent;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = getAgentColor(agent.definition.pluginId);
  const initials = getInitials(agent.definition.name);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200',
        selected
          ? 'bg-primary/8 ring-1 ring-primary/20 shadow-sm'
          : 'hover:bg-muted/60',
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white tracking-wide',
            color,
          )}
        >
          {initials}
        </div>
        <div className="absolute -bottom-0.5 -right-0.5">
          <StatusDot status={agent.status} />
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground truncate">
            {agent.definition.name}
          </span>
          {agent.pendingCount > 0 && (
            <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {agent.pendingCount}
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground truncate leading-relaxed">
          {agent.currentTask ?? agent.definition.description}
        </p>
      </div>
    </button>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-xl px-3 py-3 animate-pulse">
          <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="h-3.5 w-24 rounded bg-muted" />
            <div className="h-2.5 w-full rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function deriveTeamAgents(
  definitions: AgentDefinition[],
  runs: AgentRun[],
  tasks: HumanTask[],
): TeamAgent[] {
  return definitions.map((def) => {
    const agentRuns = runs.filter(
      (r) => r.pluginId === def.pluginId || r.pluginId === def.id,
    );
    const latestRun = agentRuns[0] ?? null; // already sorted by startedAt desc

    const runningRun = agentRuns.find((r) => r.status === 'running');
    const errorRun = latestRun?.status === 'error' ? latestRun : null;

    // Find pending tasks linked to this agent's process instances
    const agentProcessIds = new Set(agentRuns.map((r) => r.processInstanceId));
    const pendingTasks = tasks.filter(
      (t) =>
        t.status === 'pending' &&
        agentProcessIds.has(t.processInstanceId),
    );

    let status: AgentStatus = 'idle';
    if (runningRun) status = 'working';
    else if (pendingTasks.length > 0) status = 'attention';
    else if (errorRun) status = 'error';

    const currentTask = runningRun
      ? `Working on ${runningRun.stepId}...`
      : null;

    return {
      definition: def,
      status,
      currentTask,
      pendingCount: pendingTasks.length,
      latestRun,
    };
  });
}

export function AgentTeamSidebar({
  agents,
  loading,
  selectedId,
  onSelect,
}: {
  agents: TeamAgent[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const activeCount = useMemo(
    () => agents.filter((a) => a.status === 'working').length,
    [agents],
  );
  const attentionCount = useMemo(
    () => agents.filter((a) => a.status === 'attention').length,
    [agents],
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="px-5 pt-5 pb-3">
          <div className="h-5 w-32 rounded bg-muted animate-pulse" />
        </div>
        <SidebarSkeleton />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-1">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Your Team
          </h2>
          <span className="text-xs text-muted-foreground">
            ({agents.length})
          </span>
        </div>
      </div>

      {/* Quick stats */}
      <div className="px-5 pb-3 pt-1">
        <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
          {activeCount > 0 && (
            <>
              <Zap className="h-3 w-3 text-green-500" />
              <span>{activeCount} active now</span>
            </>
          )}
          {activeCount > 0 && attentionCount > 0 && (
            <span className="text-border">·</span>
          )}
          {attentionCount > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {attentionCount} need attention
            </span>
          )}
          {activeCount === 0 && attentionCount === 0 && (
            <span>All agents idle</span>
          )}
        </p>
      </div>

      <div className="mx-4 border-t" />

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No agents configured</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Add agents to your workflows to see them here
            </p>
          </div>
        ) : (
          agents.map((agent) => (
            <AgentRow
              key={agent.definition.id}
              agent={agent}
              selected={selectedId === agent.definition.id}
              onSelect={() => onSelect(agent.definition.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
