'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Wrench, Search, Plus, Shield, Plug, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { McpServerConfig } from '@mediforce/platform-core';

// ── Seed data: org-level Tool Catalog ────────────────────────────
// In production, this would come from Firestore (toolDefinitions collection).
// For now, hardcoded catalog entries demonstrate the UI and access control model.

const TOOL_CATALOG: (McpServerConfig & { id: string; category: string })[] = [
  {
    id: 'github',
    name: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: '{{GITHUB_TOKEN}}' },
    description: 'Search code, read files, create issues and pull requests in GitHub repositories.',
    allowedTools: undefined,
    category: 'Development',
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
    description: 'Read and write files in a scoped directory. Useful for document processing pipelines.',
    allowedTools: undefined,
    category: 'Data Access',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: '{{DATABASE_URL}}' },
    description: 'Execute read-only SQL queries against a PostgreSQL database.',
    allowedTools: ['query'],
    category: 'Data Access',
  },
  {
    id: 'slack',
    name: 'Slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '{{SLACK_BOT_TOKEN}}' },
    description: 'Post messages, read channels, and manage threads in Slack workspaces.',
    allowedTools: undefined,
    category: 'Communication',
  },
  {
    id: 'cdisc-library',
    name: 'CDISC Library',
    command: 'node',
    args: ['/opt/mcp-servers/cdisc-library/index.js'],
    env: { CDISC_API_KEY: '{{CDISC_API_KEY}}' },
    description: 'Look up SDTM/ADaM variable metadata, controlled terminology, and CDISC standards.',
    allowedTools: undefined,
    category: 'Clinical Data',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '{{BRAVE_API_KEY}}' },
    description: 'Web search via Brave Search API. Useful for research and fact-checking tasks.',
    allowedTools: undefined,
    category: 'Research',
  },
];

function getCategoryColor(category: string): { text: string; bg: string; dot: string } {
  const colors: Record<string, { text: string; bg: string; dot: string }> = {
    'Development': { text: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-50 dark:bg-violet-950/30', dot: 'bg-violet-500' },
    'Data Access': { text: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-950/30', dot: 'bg-blue-500' },
    'Communication': { text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/30', dot: 'bg-amber-500' },
    'Clinical Data': { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/30', dot: 'bg-emerald-500' },
    'Research': { text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-950/30', dot: 'bg-rose-500' },
  };
  return colors[category] ?? { text: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground' };
}

function getToolIcon(id: string): string {
  const icons: Record<string, string> = {
    github: '🐙',
    filesystem: '📁',
    postgres: '🐘',
    slack: '💬',
    'cdisc-library': '🧬',
    'brave-search': '🔍',
  };
  return icons[id] ?? '🔧';
}

function SecretBadge({ secret }: { secret: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-mono text-amber-700 dark:text-amber-300">
      <Shield className="h-2.5 w-2.5" />
      {secret}
    </span>
  );
}

function ToolAllowedToolsBadge({ tools }: { tools: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
      {tools.length} tool{tools.length !== 1 ? 's' : ''} allowed
    </span>
  );
}

function ToolCard({ tool, handle }: { tool: typeof TOOL_CATALOG[number]; handle: string }) {
  const categoryColor = getCategoryColor(tool.category);
  const secrets = tool.env ? Object.values(tool.env).filter((v): v is string => typeof v === 'string' && v.startsWith('{{')) : [];

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-md flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
          {getToolIcon(tool.id)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base">{tool.name}</h3>
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', categoryColor.bg, categoryColor.text)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', categoryColor.dot)} />
              {tool.category}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{tool.description}</p>
        </div>
      </div>

      {/* Details */}
      <div className="border-t border-border/50 px-4 py-3 space-y-2 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Plug className="h-3 w-3 shrink-0" />
          <code className="text-[11px] font-mono truncate">{tool.command} {(tool.args ?? []).join(' ')}</code>
        </div>

        {secrets.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Secrets:</span>
            {secrets.map((s) => (
              <SecretBadge key={s} secret={s.replace(/\{\{|\}\}/g, '')} />
            ))}
          </div>
        )}

        {tool.allowedTools && tool.allowedTools.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Access:</span>
            <ToolAllowedToolsBadge tools={tool.allowedTools} />
          </div>
        )}

        {!tool.allowedTools && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Access:</span>
            <span className="text-[10px] text-muted-foreground">All tools available</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/50 px-4 py-2.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">MCP Server</span>
        <Link
          href={`/${handle}/tools/${tool.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Details
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

export default function ToolsPage() {
  const { handle } = useParams<{ handle: string }>();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (query.trim() === '') return TOOL_CATALOG;
    const q = query.toLowerCase();
    return TOOL_CATALOG.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [query]);

  const categories = useMemo(() => {
    const cats = new Map<string, typeof TOOL_CATALOG>();
    for (const tool of filtered) {
      const existing = cats.get(tool.category) ?? [];
      existing.push(tool);
      cats.set(tool.category, existing);
    }
    return cats;
  }, [filtered]);

  return (
    <div className="flex flex-1 flex-col p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-headline font-semibold">Tools</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            MCP servers available to agent steps. Each tool provides external capabilities
            that workflows can grant to specific steps.
          </p>
        </div>
        <button
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
            'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Tool
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search tools..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Access Control Info */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 mb-6">
        <div className="flex items-start gap-2">
          <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Per-step access control</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tools from this catalog can be assigned to individual workflow steps.
              Each step declares which tools it needs — agents only see tools explicitly granted to their step.
              Secrets are scoped per-tool and resolved at runtime.
            </p>
          </div>
        </div>
      </div>

      {/* Tool Grid by Category */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Wrench className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No tools match your search.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {[...categories.entries()].map(([category, tools]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {category}
                <span className="ml-2 text-xs font-normal">({tools.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} handle={handle} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <div className="mt-8 pt-4 border-t text-xs text-muted-foreground">
        {TOOL_CATALOG.length} tools in catalog · {categories.size} categories
      </div>
    </div>
  );
}
