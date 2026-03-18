'use client';

import { useState, useEffect, useMemo } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useAgentRuns, useProcessNameMap } from '@/hooks/use-agent-runs';
import { AgentRunListTable } from '@/components/agents/agent-run-list-table';
import { StatCards } from '@/components/agents/stat-cards';

const ALL_STATUSES = [
  'running',
  'completed',
  'timed_out',
  'low_confidence',
  'error',
  'escalated',
  'flagged',
  'paused',
] as const;

interface PluginMetadata {
  name: string;
  description: string;
  inputDescription: string;
  outputDescription: string;
  roles: ('executor' | 'reviewer')[];
}

interface PluginEntry {
  name: string;
  metadata?: PluginMetadata;
}

function formatNamespace(ns: string): string {
  return ns
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

function PluginCard({ plugin }: { plugin: PluginEntry }) {
  const meta = plugin.metadata;

  if (!meta) {
    return (
      <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
        <h3 className="font-medium">{plugin.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">No metadata available</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium">{meta.name}</h3>
        <div className="flex gap-1 shrink-0">
          {meta.roles.map((role) => (
            <RoleBadge key={role} role={role} />
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{meta.description}</p>

      <div className="mt-3 space-y-2">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Input
          </span>
          <p className="text-sm">{meta.inputDescription}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output
          </span>
          <p className="text-sm">{meta.outputDescription}</p>
        </div>
      </div>
    </div>
  );
}

function PluginSkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm animate-pulse">
      <div className="h-5 w-2/3 rounded bg-muted" />
      <div className="mt-3 h-4 w-full rounded bg-muted" />
      <div className="mt-2 h-4 w-5/6 rounded bg-muted" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-1/4 rounded bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-3 w-1/4 rounded bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
      </div>
    </div>
  );
}

function PluginCatalog() {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/plugins')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch plugins: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setPlugins(data.plugins ?? []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<string, PluginEntry[]>();
    for (const plugin of plugins) {
      const slashIdx = plugin.name.indexOf('/');
      const ns = slashIdx > 0 ? plugin.name.slice(0, slashIdx) : 'other';
      const list = groups.get(ns) ?? [];
      list.push(plugin);
      groups.set(ns, list);
    }
    return groups;
  }, [plugins]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-6 w-48 rounded bg-muted animate-pulse mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <PluginSkeletonCard />
            <PluginSkeletonCard />
            <PluginSkeletonCard />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load plugins: {error}
      </div>
    );
  }

  if (plugins.length === 0) {
    return <p className="text-sm text-muted-foreground">No plugins available</p>;
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([namespace, items]) => (
        <section key={namespace}>
          <h2 className="text-lg font-semibold mb-4">{formatNamespace(namespace)}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((plugin) => (
              <PluginCard key={plugin.name} plugin={plugin} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function AgentsPage() {
  const { data: runs, loading } = useAgentRuns();
  const processNameMap = useProcessNameMap();

  const [processFilter, setProcessFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const processNames = useMemo(() => {
    const names = new Set<string>();
    for (const [, name] of processNameMap) {
      names.add(name);
    }
    return Array.from(names).sort();
  }, [processNameMap]);

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (processFilter) {
        const name = processNameMap.get(run.processInstanceId);
        if (name !== processFilter) return false;
      }
      if (statusFilter && run.status !== statusFilter) return false;
      return true;
    });
  }, [runs, processFilter, statusFilter, processNameMap]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-headline font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Available AI capabilities and run history
        </p>
      </div>

      <Tabs.Root defaultValue="overview">
        <Tabs.List className="flex gap-1 border-b mb-6">
          <Tabs.Trigger
            value="overview"
            className="px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px"
          >
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger
            value="run-history"
            className="px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px"
          >
            Run History
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" className="space-y-6">
          <StatCards runs={runs} loading={loading} />
          <PluginCatalog />
        </Tabs.Content>

        <Tabs.Content value="run-history" className="space-y-4">
          <div className="flex gap-3 items-center">
            <select
              value={processFilter ?? ''}
              onChange={(e) => setProcessFilter(e.target.value || null)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">All Workflows</option>
              {processNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter ?? ''}
              onChange={(e) => setStatusFilter(e.target.value || null)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">All Statuses</option>
              {ALL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            <span className="text-sm text-muted-foreground">
              {loading
                ? '\u2026'
                : processFilter || statusFilter
                ? `${filteredRuns.length} of ${runs.length} runs`
                : `${runs.length} runs`}
            </span>
          </div>

          <AgentRunListTable
            runs={filteredRuns}
            loading={loading}
            processNameMap={processNameMap}
          />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
