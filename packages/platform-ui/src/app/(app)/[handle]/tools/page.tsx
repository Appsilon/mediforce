'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Wrench, Search, Shield, ShieldCheck, ShieldAlert, ChevronRight, Database, Globe, HardDrive, FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TOOL_CATALOG, type CatalogTool } from '@/lib/tool-catalog-seed';

function getToolIcon(id: string) {
  const icons: Record<string, typeof Database> = {
    filesystem: HardDrive,
    fetch: Globe,
    postgres: Database,
    sqlite: Database,
    'cdisc-library': FlaskConical,
  };
  return icons[id] ?? Wrench;
}

function getSecurityLevel(tool: CatalogTool): { label: string; color: string; icon: typeof Shield } {
  const hasAllowlist = tool.allowedTools && tool.allowedTools.length > 0;
  const hasSecrets = tool.env && Object.values(tool.env).some((v) => v.startsWith('{{'));

  if (hasAllowlist && hasSecrets) {
    return { label: 'Allowlist + secrets', color: 'text-emerald-600 dark:text-emerald-400', icon: ShieldCheck };
  }
  if (hasAllowlist) {
    return { label: 'Tool allowlist', color: 'text-blue-600 dark:text-blue-400', icon: Shield };
  }
  if (hasSecrets) {
    return { label: 'Secrets required', color: 'text-blue-600 dark:text-blue-400', icon: Shield };
  }
  return { label: 'Open access', color: 'text-amber-600 dark:text-amber-400', icon: ShieldAlert };
}

function ToolCard({ tool, handle }: { tool: CatalogTool; handle: string }) {
  const Icon = getToolIcon(tool.id);
  const security = getSecurityLevel(tool);
  const SecurityIcon = security.icon;

  return (
    <Link
      href={`/${handle}/tools/${tool.id}`}
      className="group rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-md flex flex-col"
    >
      <div className="px-4 py-4 flex items-start gap-3 flex-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base group-hover:text-primary transition-colors">{tool.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
        </div>
      </div>

      <div className="border-t border-border/50 px-4 py-2.5 flex items-center justify-between">
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', security.color)}>
          <SecurityIcon className="h-3.5 w-3.5" />
          {security.label}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          View details
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
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
    const cats = new Map<string, CatalogTool[]>();
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
      <div className="mb-6">
        <h1 className="text-xl font-headline font-semibold">Tools</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          External capabilities available to workflow steps. Assign tools to control what each agent can access.
        </p>
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

      {/* Footer */}
      <div className="mt-8 pt-4 border-t text-xs text-muted-foreground">
        {TOOL_CATALOG.length} tools · Each tool&apos;s access level is determined by its secrets and tool allowlist configuration.
      </div>
    </div>
  );
}
