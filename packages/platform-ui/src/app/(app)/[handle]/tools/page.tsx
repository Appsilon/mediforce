'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ChevronRight,
  Database,
  FlaskConical,
  Globe,
  HardDrive,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import type {
  AgentDefinition,
  CreateSkillRegistryInput,
  SkillRegistry,
  ToolCatalogEntry,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-fetch';
import { listCatalogEntries } from '@/lib/mcp-admin-client';
import {
  createSkillRegistry,
  deleteSkillRegistry,
  listSkillRegistries,
  updateSkillRegistry,
} from '@/lib/skill-registries-client';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { useAuth } from '@/contexts/auth-context';
import { SkillRegistryList } from '@/components/skill-registries/skill-registry-list';
import { SkillRegistryForm } from '@/components/skill-registries/skill-registry-form';
import { DeleteSkillRegistryDialog } from '@/components/skill-registries/delete-skill-registry-dialog';
import {
  collectHttpBindings,
  countStdioUsage,
  hasSecretTemplate,
  type HttpBindingRow,
} from './tool-inventory';

function getStdioIcon(id: string): typeof Database {
  const icons: Record<string, typeof Database> = {
    filesystem: HardDrive,
    fetch: Globe,
    postgres: Database,
    sqlite: Database,
    'cdisc-library': FlaskConical,
    tealflow: FlaskConical,
  };
  return icons[id] ?? Wrench;
}

type StdioSecurity = {
  label: string;
  color: string;
  Icon: typeof Shield;
};

function stdioSecurity(entry: ToolCatalogEntry, usedWithAllowlist: boolean): StdioSecurity {
  const secrets = hasSecretTemplate(entry.env);
  if (usedWithAllowlist && secrets) {
    return { label: 'Allowlist + secrets', color: 'text-emerald-600 dark:text-emerald-400', Icon: ShieldCheck };
  }
  if (usedWithAllowlist) {
    return { label: 'Tool allowlist', color: 'text-blue-600 dark:text-blue-400', Icon: Shield };
  }
  if (secrets) {
    return { label: 'Secrets required', color: 'text-blue-600 dark:text-blue-400', Icon: Shield };
  }
  return { label: 'Open access', color: 'text-amber-600 dark:text-amber-400', Icon: ShieldAlert };
}

function matchesQuery(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

function StdioCard({
  entry,
  handle,
  usageCount,
  withAllowlist,
}: {
  entry: ToolCatalogEntry;
  handle: string;
  usageCount: number;
  withAllowlist: boolean;
}) {
  const Icon = getStdioIcon(entry.id);
  const security = stdioSecurity(entry, withAllowlist);
  const SecurityIcon = security.Icon;
  return (
    <Link
      href={`/${handle}/tools/${entry.id}`}
      className="group rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-md flex flex-col"
    >
      <div className="px-4 py-4 flex items-start gap-3 flex-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base font-mono group-hover:text-primary transition-colors">{entry.id}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {entry.description ?? <span className="italic">No description</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Used by {usageCount} {usageCount === 1 ? 'agent' : 'agents'}
          </p>
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

function HttpCard({ binding, handle }: { binding: HttpBindingRow; handle: string }) {
  let host = binding.url;
  try {
    host = new URL(binding.url).host;
  } catch {
    // leave full string if URL parse fails
  }
  const badge = binding.allowedTools && binding.allowedTools.length > 0
    ? { label: 'Tool allowlist', color: 'text-blue-600 dark:text-blue-400', Icon: Shield }
    : binding.hasSecretHeaders
      ? { label: 'Secrets required', color: 'text-blue-600 dark:text-blue-400', Icon: Shield }
      : { label: 'Open access', color: 'text-amber-600 dark:text-amber-400', Icon: ShieldAlert };
  const BadgeIcon = badge.Icon;
  return (
    <Link
      href={`/${handle}/agents/definitions/${binding.agentId}`}
      className="group rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-md flex flex-col"
    >
      <div className="px-4 py-4 flex items-start gap-3 flex-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
          <Globe className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base font-mono group-hover:text-primary transition-colors">{binding.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground font-mono truncate">{host}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bound to <span className="font-medium">{binding.agentName}</span>
          </p>
        </div>
      </div>
      <div className="border-t border-border/50 px-4 py-2.5 flex items-center justify-between">
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', badge.color)}>
          <BadgeIcon className="h-3.5 w-3.5" />
          {badge.label}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          View agent
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

export default function ToolsPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;
  const { canAdmin } = useNamespaceRole(handle);
  const { firebaseUser, loading: authLoading } = useAuth();

  const [entries, setEntries] = useState<ToolCatalogEntry[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalog, agentList] = await Promise.all([
        listCatalogEntries(handle),
        apiFetch('/api/agent-definitions').then(async (res) =>
          res.ok ? ((await res.json()) as { agents: AgentDefinition[] }).agents : [],
        ),
      ]);
      setEntries(catalog);
      setAgents(agentList);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tools.');
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    // Wait for Firebase auth state to settle so apiFetch can attach a Bearer
    // token — middleware 401s /api/admin/* requests without it.
    if (authLoading || firebaseUser === null) return;
    void refresh();
  }, [authLoading, firebaseUser, refresh]);

  const filteredStdio = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return entries;
    return entries.filter(
      (entry) =>
        matchesQuery(entry.id, q) ||
        matchesQuery(entry.description, q) ||
        matchesQuery(entry.command, q),
    );
  }, [entries, query]);

  const allHttpBindings = useMemo(() => collectHttpBindings(agents), [agents]);
  const filteredHttp = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return allHttpBindings;
    return allHttpBindings.filter(
      (row) =>
        matchesQuery(row.name, q) ||
        matchesQuery(row.url, q) ||
        matchesQuery(row.agentName, q),
    );
  }, [allHttpBindings, query]);

  const totalVisible = filteredStdio.length + filteredHttp.length;

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-headline font-semibold">Tools</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            External capabilities available to agents in @{handle}. Admins curate the stdio catalog; any member can bind
            HTTP MCPs to agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canAdmin && (
            <>
              <Link
                href={`/${handle}/admin/tool-catalog`}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                Manage catalog
              </Link>
              <Link
                href={`/${handle}/admin/oauth-providers`}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                <KeyRound className="h-3.5 w-3.5" />
                OAuth providers
              </Link>
            </>
          )}
          <Link
            href={`/${handle}/agents`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plug className="h-3.5 w-3.5" />
            Add HTTP binding
          </Link>
        </div>
      </div>

      <Tabs.Root defaultValue="catalog">
        <Tabs.List className="flex gap-1 border-b mb-6">
          <Tabs.Trigger
            value="catalog"
            className="px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px"
          >
            Tool Catalog
          </Tabs.Trigger>
          <Tabs.Trigger
            value="skill-registries"
            className="px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px"
          >
            Skill Repositories
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="catalog">
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search tools..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error !== null && (
            <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">Loading tools…</div>
          ) : totalVisible === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Wrench className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {query.trim() === ''
                  ? 'No tools configured yet. Add entries via “Manage catalog” (admin) or bind an HTTP MCP to an agent.'
                  : 'No tools match your search.'}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {filteredStdio.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Stdio servers
                    <span className="ml-2 text-xs font-normal">({filteredStdio.length})</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredStdio.map((entry) => {
                      const usage = countStdioUsage(agents, entry.id);
                      return (
                        <StdioCard
                          key={entry.id}
                          entry={entry}
                          handle={handle}
                          usageCount={usage.total}
                          withAllowlist={usage.withAllowlist}
                        />
                      );
                    })}
                  </div>
                </section>
              )}
              {filteredHttp.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    HTTP servers
                    <span className="ml-2 text-xs font-normal">({filteredHttp.length})</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredHttp.map((row) => (
                      <HttpCard key={row.key} binding={row} handle={handle} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {!loading && totalVisible > 0 && (
            <div className="mt-8 pt-4 border-t text-xs text-muted-foreground">
              {filteredStdio.length} stdio · {filteredHttp.length} HTTP · Security levels reflect secret templates and tool
              allowlists configured on agent bindings.
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="skill-registries">
          <SkillRegistriesPanel handle={handle} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

type SkillRegistriesPanelMode =
  | { kind: 'idle' }
  | { kind: 'create' }
  | { kind: 'edit'; registry: SkillRegistry };

function SkillRegistriesPanel({ handle }: { handle: string }) {
  const { firebaseUser, loading: authLoading } = useAuth();
  const [registries, setRegistries] = useState<SkillRegistry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<SkillRegistriesPanelMode>({ kind: 'idle' });
  const [deleteTarget, setDeleteTarget] = useState<SkillRegistry | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const all = await listSkillRegistries();
      const scoped = all.filter((registry) => registry.namespace === handle);
      setRegistries(scoped);
      setMode((current) => {
        if (current.kind !== 'edit') return current;
        const fresh = scoped.find((registry) => registry.id === current.registry.id);
        return fresh !== undefined ? { kind: 'edit', registry: fresh } : { kind: 'idle' };
      });
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load skill registries.');
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    if (authLoading || firebaseUser === null) return;
    void refresh();
  }, [authLoading, firebaseUser, refresh]);

  const handleSelect = useCallback(
    (id: string) => {
      const registry = registries.find((reg) => reg.id === id);
      if (registry === undefined) return;
      setMode({ kind: 'edit', registry });
      setFormError(null);
    },
    [registries],
  );

  const handleNew = useCallback(() => {
    setMode({ kind: 'create' });
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (input: CreateSkillRegistryInput) => {
      setFormError(null);
      try {
        if (mode.kind === 'edit') {
          const updated = await updateSkillRegistry(mode.registry.id, input);
          setMode({ kind: 'edit', registry: updated });
        } else {
          const created = await createSkillRegistry(input);
          setMode({ kind: 'edit', registry: created });
        }
        await refresh();
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Save failed.');
        throw err;
      }
    },
    [mode, refresh],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    setMode({ kind: 'idle' });
    setDeleteTarget(null);
    try {
      await deleteSkillRegistry(target.id);
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Delete failed.');
    }
    await refresh();
  }, [deleteTarget, refresh]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Git repositories that contain skills. Agents reference skills as (registry, name) — bumping the commit SHA
          here updates every agent that points at the registry.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New registry
          </button>
        </div>
      </div>

      {listError !== null && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {listError}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_1.5fr]">
        <aside>
          {loading ? (
            <div className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground animate-pulse">
              Loading…
            </div>
          ) : (
            <SkillRegistryList
              registries={registries}
              selectedId={mode.kind === 'edit' ? mode.registry.id : null}
              onSelect={handleSelect}
            />
          )}
        </aside>

        <section className="rounded-lg border bg-card px-5 py-5">
          {mode.kind === 'idle' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm font-medium">
                {registries.length === 0 ? 'No skill registries yet.' : 'Select a registry to edit.'}
              </p>
              <p className="text-xs text-muted-foreground">
                {registries.length === 0
                  ? 'Add a git repo to make its skills available to agents.'
                  : 'Or click “New registry” above to add another.'}
              </p>
              {registries.length === 0 && (
                <button
                  type="button"
                  onClick={handleNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New registry
                </button>
              )}
            </div>
          )}

          {mode.kind === 'create' && (
            <>
              <h2 className="mb-4 text-base font-semibold">New skill registry</h2>
              <SkillRegistryForm
                registry={null}
                namespace={handle}
                onSubmit={handleSubmit}
                submitError={formError}
              />
            </>
          )}

          {mode.kind === 'edit' && (
            <>
              <h2 className="mb-4 text-base font-semibold">
                Edit <span className="font-mono text-sm">{mode.registry.name}</span>
              </h2>
              <SkillRegistryForm
                key={mode.registry.id}
                registry={mode.registry}
                namespace={handle}
                onSubmit={handleSubmit}
                onDelete={() => setDeleteTarget(mode.registry)}
                submitError={formError}
              />
            </>
          )}
        </section>
      </div>

      {deleteTarget !== null && (
        <DeleteSkillRegistryDialog
          registryName={deleteTarget.name}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  );
}
