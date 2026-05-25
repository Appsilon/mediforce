import { cn } from '@/lib/utils';
import { Users, Bot, GitBranch, ClipboardList, Plug } from 'lucide-react';
import type { MonitoringData } from '@/hooks/use-monitoring';
import type { AgentRun } from '@mediforce/platform-core';

interface Props {
  monitoringData: MonitoringData;
  agentRuns: AgentRun[];
  agentRunsLoading: boolean;
  onTabChange: (tab: string) => void;
}

export function MonitoringOverviewCards({ monitoringData, agentRuns, agentRunsLoading, onTabChange }: Props) {
  const { statusCounts, roleCounts, loading } = monitoringData;

  const runningAgents = agentRuns.filter((r) => r.status === 'running').length;
  const errorAgents = agentRuns.filter((r) => r.status === 'error').length;
  const openTasks = roleCounts.reduce((sum, r) => sum + r.total, 0);

  const cards = [
    {
      tab: 'users',
      icon: Users,
      label: 'Users',
      primary: '3',
      secondary: 'active today',
      color: 'text-blue-600 dark:text-blue-400',
      mocked: true,
    },
    {
      tab: 'agents',
      icon: Bot,
      label: 'Agents',
      primary: agentRunsLoading ? '—' : String(runningAgents),
      secondary: errorAgents > 0 ? `${errorAgents} error${errorAgents !== 1 ? 's' : ''}` : 'running',
      color:
        errorAgents > 0 ? 'text-red-600 dark:text-red-400' : 'text-violet-600 dark:text-violet-400',
    },
    {
      tab: 'workflows',
      icon: GitBranch,
      label: 'Workflows',
      primary: loading ? '—' : String(statusCounts.running),
      secondary: statusCounts.failed > 0 ? `${statusCounts.failed} failed` : 'running',
      color:
        statusCounts.failed > 0
          ? 'text-red-600 dark:text-red-400'
          : 'text-green-600 dark:text-green-400',
    },
    {
      tab: 'tasks',
      icon: ClipboardList,
      label: 'Tasks',
      primary: loading ? '—' : String(openTasks),
      secondary: 'open tasks',
      color: openTasks > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
    },
    {
      tab: 'integrations',
      icon: Plug,
      label: 'Integrations',
      primary: '5/5',
      secondary: 'healthy',
      color: 'text-green-600 dark:text-green-400',
      mocked: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {cards.map(({ tab, icon: Icon, label, primary, secondary, color, mocked }) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className="rounded-lg border bg-card p-4 space-y-2 text-left transition-all hover:shadow-md hover:bg-muted/40"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
              <Icon className={cn('h-3.5 w-3.5', color)} />
            </div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {label}
            </span>
            {mocked === true && (
              <span className="ml-auto text-[9px] text-muted-foreground/50 italic">mock</span>
            )}
          </div>
          <div>
            <div className={cn('text-2xl font-bold font-headline', color)}>{primary}</div>
            <div className="text-xs text-muted-foreground">{secondary}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
