'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { X } from 'lucide-react';
import { useAgentRuns } from '@/hooks/use-agent-runs';
import { useAllTasks } from '@/hooks/use-tasks';
import { cn } from '@/lib/utils';
import type { AgentDefinition } from '@mediforce/platform-core';
import { AgentTeamSidebar, deriveTeamAgents } from './agent-team-sidebar';
import { ActivityFeed } from './activity-feed';
import { AgentDetailPanel } from './agent-detail-panel';

export function TeamDashboard() {
  const { handle } = useParams<{ handle: string }>();
  const { data: runs, loading: runsLoading } = useAgentRuns();
  const { data: tasks, loading: tasksLoading } = useAllTasks();

  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    fetch('/api/agent-definitions')
      .then((res) => res.json())
      .then((data: { agents: AgentDefinition[] }) => setAgents(data.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, []);

  const teamAgents = useMemo(
    () => deriveTeamAgents(agents, runs, tasks),
    [agents, runs, tasks],
  );

  const selectedAgent = useMemo(
    () => teamAgents.find((a) => a.definition.id === selectedId) ?? null,
    [teamAgents, selectedId],
  );

  const agentRunsForSelected = useMemo(() => {
    if (selectedAgent === null) return [];
    const def = selectedAgent.definition;
    return runs.filter(
      (r) => r.pluginId === def.pluginId || r.pluginId === def.id,
    );
  }, [selectedAgent, runs]);

  const loading = runsLoading || tasksLoading || agentsLoading;

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
    setMobileDetailOpen(true);
  }, []);

  return (
    <div className="flex h-full">
      {/* Left: Agent team sidebar — desktop */}
      <aside className="hidden lg:flex w-[280px] shrink-0 border-r flex-col bg-card/50">
        <AgentTeamSidebar
          agents={teamAgents}
          loading={loading}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </aside>

      {/* Left: Agent team sidebar — mobile (horizontal scroll) */}
      <div className="lg:hidden border-b bg-card/50 w-full absolute top-0 left-0 z-10">
        <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-none">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0"
                />
              ))
            : teamAgents.map((agent) => {
                const id = (agent.definition.pluginId ?? '').toLowerCase();
                const color = id.includes('claude')
                  ? 'bg-violet-500'
                  : id.includes('opencode')
                    ? 'bg-blue-500'
                    : id.includes('script')
                      ? 'bg-slate-500'
                      : id.includes('risk') || id.includes('driver') || id.includes('supply')
                        ? 'bg-emerald-500'
                        : 'bg-primary';
                const initials = agent.definition.name
                  .split(/[\s-_]+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? '')
                  .join('');
                const isSelected = selectedId === agent.definition.id;
                return (
                  <button
                    key={agent.definition.id}
                    type="button"
                    onClick={() => handleSelect(agent.definition.id)}
                    className={cn(
                      'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white transition-all',
                      color,
                      isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                  >
                    {initials}
                    {agent.pendingCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white px-1">
                        {agent.pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
        </div>
      </div>

      {/* Center: Activity feed */}
      <main className="flex-1 min-w-0 flex flex-col lg:pt-0 pt-16">
        <ActivityFeed
          runs={runs}
          tasks={tasks}
          agents={agents}
          loading={loading}
          handle={handle}
        />
      </main>

      {/* Right: Detail panel — desktop */}
      <aside
        className={cn(
          'hidden xl:flex w-[380px] shrink-0 border-l flex-col bg-card/30 transition-all duration-300',
          selectedAgent === null && 'xl:hidden',
        )}
      >
        {selectedAgent !== null && (
          <AgentDetailPanel
            agent={selectedAgent}
            agentRuns={agentRunsForSelected}
            handle={handle}
            onClose={() => setSelectedId(null)}
          />
        )}
      </aside>

      {/* Right: Detail panel — mobile overlay */}
      {mobileDetailOpen && selectedAgent !== null && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileDetailOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-[400px] bg-background border-l shadow-xl overflow-y-auto">
            <div className="flex items-center justify-end p-3">
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <AgentDetailPanel
              agent={selectedAgent}
              agentRuns={agentRunsForSelected}
              handle={handle}
              onClose={() => setMobileDetailOpen(false)}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
