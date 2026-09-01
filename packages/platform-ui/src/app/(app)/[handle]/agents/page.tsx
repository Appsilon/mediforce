'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Bot, Cpu, Terminal, BarChart3, Settings, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getModelDisplayName } from '@/lib/agent-models';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import { ConceptPopover } from '@/components/ui/concept-intro';
import type { LucideIcon } from 'lucide-react';
import type { AgentDefinition } from '@mediforce/platform-core';

interface AgentMetadata {
  name: string;
  description: string;
  inputDescription: string;
  outputDescription: string;
  roles: ('executor' | 'reviewer')[];
  foundationModel?: string;
}

interface AgentEntry {
  name: string;
  metadata?: AgentMetadata;
  definitionId?: string;
  visibility?: 'public' | 'private';
}



function getAgentIcon(agentId: string): { Icon: LucideIcon; colorClass: string; bgClass: string } {
  const id = agentId.toLowerCase();
  if (id.includes('claude')) return { Icon: Bot, colorClass: 'text-violet-500', bgClass: 'bg-violet-500/10' };
  if (id.includes('opencode')) return { Icon: Cpu, colorClass: 'text-blue-500', bgClass: 'bg-blue-500/10' };
  if (id.includes('script')) return { Icon: Terminal, colorClass: 'text-slate-500', bgClass: 'bg-slate-500/10' };
  if (id.includes('risk') || id.includes('driver') || id.includes('supply')) return { Icon: BarChart3, colorClass: 'text-emerald-500', bgClass: 'bg-emerald-500/10' };
  return { Icon: Bot, colorClass: 'text-primary', bgClass: 'bg-primary/10' };
}

function AgentCard({ agent, handle }: { agent: AgentEntry; handle: string }) {
  const meta = agent.metadata;
  const { Icon, colorClass, bgClass } = getAgentIcon(agent.name);
  const descRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = descRef.current;
    if (el) {
      setIsClamped(el.scrollHeight > el.clientHeight);
    }
  }, [meta?.description]);

  if (!meta) {
    return (
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 mb-[10px]">
        <div className="px-4 py-4 flex items-center gap-3">
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', bgClass)}>
            <Icon className={cn('h-3.5 w-3.5', colorClass)} />
          </div>
          <h3 className="font-semibold text-base">{agent.name}</h3>
        </div>
        <div className="border-t border-border/50 px-4 py-3">
          <p className="text-sm text-muted-foreground">No metadata available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-md flex flex-col mb-[10px]">
      {/* Header: icon + name + description + configure button */}
      <div className="px-4 py-4 flex items-start gap-3">
        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md mt-0.5', bgClass)}>
          <Icon className={cn('h-3.5 w-3.5', colorClass)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base">{meta.name}</h3>
            {agent.visibility === 'private' && (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                Private
              </span>
            )}
          </div>
          <p
            ref={descRef}
            className={cn('mt-1 text-sm text-muted-foreground', !expanded && 'line-clamp-2')}
          >
            {meta.description}
          </p>
          {(isClamped || expanded) && (
            <button
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-0.5 text-[11px] text-muted-foreground/70 hover:text-primary transition-colors"
            >
              {expanded ? 'read less' : 'read more'}
            </button>
          )}
        </div>
        {agent.definitionId && (
          <Link
            href={`/${handle}/agents/definitions/${agent.definitionId}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings className="h-3 w-3" />
            Configure
          </Link>
        )}
      </div>

      {/* 3-row table: label | value */}
      <div className="border-t border-border/50 divide-y divide-border/50 flex-1">
        <div className="grid grid-cols-[5rem_1fr] items-start px-4 py-2 gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pt-0.5">Model</span>
          <div>
            {meta.foundationModel ? (
              <p className="text-xs text-foreground/80">{getModelDisplayName(meta.foundationModel)}</p>
            ) : (
              <p className="text-xs text-muted-foreground">—</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[5rem_1fr] items-start px-4 py-2 gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pt-0.5">Input</span>
          <p className="text-xs text-foreground/80">{meta.inputDescription}</p>
        </div>
        <div className="grid grid-cols-[5rem_1fr] items-start px-4 py-2 gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pt-0.5">Output</span>
          <p className="text-xs text-foreground/80">{meta.outputDescription}</p>
        </div>
      </div>
    </div>
  );
}

function AgentSkeletonCard() {
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden animate-pulse flex flex-col">
      <div className="px-4 py-4 flex items-start gap-3">
        <div className="h-7 w-7 rounded-md bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-5/6 rounded bg-muted" />
        </div>
      </div>
      <div className="border-t border-border/50 divide-y divide-border/50">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid grid-cols-[5rem_1fr] px-4 py-2 gap-3">
            <div className="h-2.5 w-10 rounded bg-muted mt-0.5" />
            <div className="space-y-1.5">
              <div className="h-2.5 w-full rounded bg-muted" />
              <div className="h-2.5 w-4/5 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function agentMatchesQuery(agent: AgentEntry, query: string): boolean {
  const q = query.toLowerCase();
  const meta = agent.metadata;
  return (
    agent.name.toLowerCase().includes(q) ||
    (meta?.name.toLowerCase().includes(q) ?? false) ||
    (meta?.description.toLowerCase().includes(q) ?? false) ||
    (meta?.foundationModel?.toLowerCase().includes(q) ?? false) ||
    (meta?.inputDescription.toLowerCase().includes(q) ?? false) ||
    (meta?.outputDescription.toLowerCase().includes(q) ?? false)
  );
}

function agentDefinitionToEntry(def: AgentDefinition): AgentEntry {
  return {
    name: def.runtimeId ?? def.id,
    definitionId: def.id,
    visibility: def.visibility ?? 'private',
    metadata: {
      name: def.name,
      description: def.description,
      inputDescription: def.inputDescription,
      outputDescription: def.outputDescription,
      roles: [],
      foundationModel: def.foundationModel,
    },
  };
}

function AgentCatalog({ handle }: { handle: string }) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    apiFetch('/api/agents')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch agent definitions: ${res.status}`);
        return res.json() as Promise<{ agents: AgentDefinition[] }>;
      })
      .then((definitionsData) => {
        // Map from runtimeId → definition entry. Dedups definitions that share a
        // runtimeId (e.g. an older seeded doc + the builtin-seeded doc).
        const definitionByRuntimeId = new Map(
          (definitionsData.agents ?? []).map((def) => {
            const entry = agentDefinitionToEntry(def);
            return [entry.name, entry] as const;
          }),
        );
        setAgents([...definitionByRuntimeId.values()]);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(
    () => (query.trim() === '' ? agents : agents.filter((a) => agentMatchesQuery(a, query.trim()))),
    [agents, query],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="relative">
          <div className="h-9 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AgentSkeletonCard />
          <AgentSkeletonCard />
          <AgentSkeletonCard />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load agents: {error}
      </div>
    );
  }

  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">No agents available</p>;
  }

  return (
    <div className="space-y-4">
      <div className="relative w-full lg:w-1/3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search agents by name, model, input, output…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No agents match your search.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((agent) => (
            <AgentCard key={agent.name} agent={agent} handle={handle} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentsPage() {
  const { handle } = useParams<{ handle: string }>();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-bold">Custom Agents</h1>
            <ConceptPopover label="What is an agent?">
              <p>
                <strong>An agent is a reusable configuration a workflow step calls by id</strong> — a system prompt
                plus the MCP servers that step is allowed to reach. One agent can power many steps, and agents are
                not versioned, so editing one changes every step that already references it.
              </p>
              <p>
                The model a run uses is chosen per step in the workflow definition, not on the agent.
              </p>
            </ConceptPopover>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable agent configurations that workflow steps call by id
          </p>
        </div>
        <Link
          href={`/${handle}/agents/new`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
            'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent
        </Link>
      </div>

      <AgentCatalog handle={handle} />
    </div>
  );
}
