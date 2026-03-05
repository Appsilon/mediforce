'use client';

import { useState, useEffect, useMemo } from 'react';

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

function SkeletonCard() {
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

export default function CatalogPage() {
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-headline font-semibold">Agent Catalog</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Available AI capabilities for process configuration
        </p>
      </div>

      {loading && (
        <div className="space-y-6">
          <div>
            <div className="h-6 w-48 rounded bg-muted animate-pulse mb-4" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load plugins: {error}
        </div>
      )}

      {!loading && !error && plugins.length === 0 && (
        <p className="text-sm text-muted-foreground">No plugins available</p>
      )}

      {!loading &&
        !error &&
        Array.from(grouped.entries()).map(([namespace, items]) => (
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
