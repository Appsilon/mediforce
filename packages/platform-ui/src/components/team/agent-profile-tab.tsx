'use client';

import {
  FileCode2,
  Cpu,
  Puzzle,
  Settings2,
  Wrench,
  Plug,
  Database,
  Terminal,
  GitBranch,
  Network,
  ShieldCheck,
  Bell,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamAgent } from './agent-team-sidebar';

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

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
    </div>
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
  const colors: Record<string, string> = {
    L0: 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400',
    L1: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
    L2: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
    L3: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    L4: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        colors[level] ?? 'bg-muted text-muted-foreground',
      )}
    >
      <Zap className="h-3 w-3" />
      {level} — {labels[level] ?? level}
    </span>
  );
}

/** Mock tool definitions per plugin type */
function getToolsForPlugin(pluginId: string | undefined): Array<{ name: string; icon: React.ElementType }> {
  const id = (pluginId ?? '').toLowerCase();
  if (id.includes('risk') || id.includes('detection')) {
    return [
      { name: 'Firestore (read)', icon: Database },
      { name: 'Supply Chain API', icon: Network },
      { name: 'Risk Scoring Model', icon: ShieldCheck },
    ];
  }
  if (id.includes('claude') || id.includes('code')) {
    return [
      { name: 'File System', icon: FileCode2 },
      { name: 'Terminal', icon: Terminal },
      { name: 'Git', icon: GitBranch },
    ];
  }
  if (id.includes('driver')) {
    return [
      { name: 'Workflow Engine', icon: Settings2 },
      { name: 'Agent Registry', icon: Puzzle },
      { name: 'Notification Service', icon: Bell },
    ];
  }
  if (id.includes('opencode')) {
    return [
      { name: 'File System', icon: FileCode2 },
      { name: 'Terminal', icon: Terminal },
      { name: 'Git', icon: GitBranch },
    ];
  }
  if (id.includes('script')) {
    return [
      { name: 'Sandbox Runtime', icon: Terminal },
      { name: 'File System (scoped)', icon: FileCode2 },
    ];
  }
  if (id.includes('manager') || id.includes('coordinator')) {
    return [
      { name: 'Workflow Engine', icon: Settings2 },
      { name: 'Agent Registry', icon: Puzzle },
      { name: 'Task Manager', icon: Wrench },
    ];
  }
  return [
    { name: 'Workflow Engine', icon: Settings2 },
  ];
}

export function AgentProfileTab({ agent }: { agent: TeamAgent }) {
  const def = agent.definition;
  const color = getAgentColor(def.pluginId);
  const initials = getInitials(def.name);
  const tools = getToolsForPlugin(def.pluginId);

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div className="px-5 pt-4">
        <div className="flex items-start gap-3 mb-3">
          <div
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-bold text-white shrink-0',
              color,
            )}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold font-headline text-foreground">
              {def.name}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5 mb-2">
              <Cpu className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] text-muted-foreground truncate">
                {def.foundationModel || 'No model configured'}
              </span>
            </div>
            <AutonomyBadge level={agent.latestRun?.autonomyLevel ?? 'L2'} />
          </div>
        </div>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {def.description || 'No description provided.'}
        </p>
      </div>

      {/* System Prompt */}
      <div className="px-5">
        <SectionHeader title="System Prompt" icon={FileCode2} />
        {def.systemPrompt !== '' ? (
          <div className="rounded-xl bg-zinc-900 dark:bg-zinc-950 p-4 overflow-x-auto">
            <pre className="text-[12px] text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
              {def.systemPrompt}
            </pre>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-muted-foreground/20 bg-muted/30 p-4 text-center">
            <p className="text-[12px] text-muted-foreground mb-2">
              System prompt not configured
            </p>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-muted-foreground/60 border border-muted-foreground/15 cursor-not-allowed"
            >
              <Settings2 className="h-3 w-3" />
              Configure
            </button>
          </div>
        )}
      </div>

      {/* Skills */}
      <div className="px-5">
        <SectionHeader title="Skills" icon={Puzzle} />
        {def.skillFileNames.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {def.skillFileNames.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 text-[12px] font-medium text-foreground"
              >
                <FileCode2 className="h-3 w-3 text-muted-foreground" />
                {skill}
              </span>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-muted-foreground/20 bg-muted/30 p-4 text-center">
            <p className="text-[12px] text-muted-foreground">
              No skills configured
            </p>
          </div>
        )}
      </div>

      {/* Tools & Integrations (MCP) */}
      <div className="px-5">
        <SectionHeader title="Tools & Integrations" icon={Wrench} />
        <div className="grid grid-cols-1 gap-2">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                <tool.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-[13px] font-medium text-foreground">
                {tool.name}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-muted-foreground/20 px-3 py-2.5 text-[12px] font-medium text-muted-foreground/60 cursor-not-allowed"
        >
          <Plug className="h-3.5 w-3.5" />
          Connect MCP Server
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
            Coming soon
          </span>
        </button>
      </div>

      {/* Configuration */}
      <div className="px-5 pb-6">
        <SectionHeader title="Configuration" icon={Settings2} />
        <div className="rounded-xl border bg-card divide-y">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-[12px] text-muted-foreground">Foundation Model</span>
            <span className="text-[12px] font-medium text-foreground font-mono">
              {def.foundationModel || '--'}
            </span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-[12px] text-muted-foreground">Plugin ID</span>
            <span className="text-[12px] font-medium text-foreground font-mono">
              {def.pluginId ?? '--'}
            </span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-[12px] text-muted-foreground">Input</span>
            <span className="text-[12px] text-foreground max-w-[60%] text-right truncate" title={def.inputDescription}>
              {def.inputDescription || '--'}
            </span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-[12px] text-muted-foreground">Output</span>
            <span className="text-[12px] text-foreground max-w-[60%] text-right truncate" title={def.outputDescription}>
              {def.outputDescription || '--'}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[12px] font-medium text-muted-foreground/60 cursor-not-allowed"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Edit Configuration
        </button>
      </div>
    </div>
  );
}
