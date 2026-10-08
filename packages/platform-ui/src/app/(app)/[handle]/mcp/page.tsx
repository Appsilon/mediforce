'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Database,
  FlaskConical,
  Globe,
  HardDrive,
  KeyRound,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { AgentDefinition, ToolCatalogEntry } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { ConceptPopover } from '@/components/ui/concept-intro';
import { routes } from '@/lib/routes';
import { mediforce } from '@/lib/mediforce';
import { CatalogForm } from '@/components/admin/tool-catalog/catalog-form';
import { DeleteCatalogEntryDialog } from '@/components/admin/tool-catalog/delete-catalog-entry-dialog';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { useAuth } from '@/contexts/auth-context';
import { findCatalogUsage, securityLevel, type CatalogUsage, type SecurityLevel } from './tool-inventory';

function getEntryIcon(entry: ToolCatalogEntry): typeof Database {
  if (entry.type === 'http') return Globe;
  const icons: Record<string, typeof Database> = {
    filesystem: HardDrive,
    fetch: Globe,
    postgres: Database,
    sqlite: Database,
    'cdisc-library': FlaskConical,
    tealflow: FlaskConical,
  };
  return icons[entry.id] ?? Wrench;
}

const SECURITY_BADGES: Record<SecurityLevel, { label: string; color: string; Icon: typeof Shield }> = {
  'allowlist-and-secrets': { label: 'Allowlist + secrets', color: 'text-emerald-600 dark:text-emerald-400', Icon: ShieldCheck },
  allowlist: { label: 'Tool allowlist', color: 'text-blue-600 dark:text-blue-400', Icon: Shield },
  secrets: { label: 'Secrets required', color: 'text-blue-600 dark:text-blue-400', Icon: Shield },
  oauth: { label: 'OAuth', color: 'text-blue-600 dark:text-blue-400', Icon: Shield },
  open: { label: 'Open access', color: 'text-amber-600 dark:text-amber-400', Icon: ShieldAlert },
};

function entryTarget(entry: ToolCatalogEntry): string {
  if (entry.type === 'stdio') return [entry.command, ...(entry.args ?? [])].join(' ');
  try {
    return new URL(entry.url).host;
  } catch {
    return entry.url;
  }
}

function matchesQuery(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

function EntryCard({
  entry,
  usages,
  onOpen,
}: {
  entry: ToolCatalogEntry;
  usages: CatalogUsage[];
  onOpen: () => void;
}) {
  const Icon = getEntryIcon(entry);
  const badge = SECURITY_BADGES[securityLevel(entry, usages)];
  const BadgeIcon = badge.Icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${entry.id}`}
      className="group rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-md flex flex-col text-left"
    >
      <div className="px-4 py-4 flex items-start gap-3 flex-1 w-full">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base font-mono group-hover:text-primary transition-colors">{entry.id}</h3>
          <p className="mt-1 text-xs text-muted-foreground font-mono truncate">{entryTarget(entry)}</p>
          {entry.description !== undefined && (
            <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Used by {usages.length} {usages.length === 1 ? 'agent' : 'agents'}
          </p>
        </div>
      </div>
      <div className="border-t border-border/50 px-4 py-2.5 w-full">
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', badge.color)}>
          <BadgeIcon className="h-3.5 w-3.5" />
          {badge.label}
        </span>
      </div>
    </button>
  );
}

function UsedBy({ handle, usages }: { handle: string; usages: CatalogUsage[] }) {
  return (
    <section className="mt-6 border-t pt-4">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        Used by agents
      </h3>
      {usages.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agent binds this server yet. Add it from an agent&apos;s <em>MCP Servers</em> section.
        </p>
      ) : (
        <ul className="space-y-2">
          {usages.map((usage) => (
            <li
              key={`${usage.agentId}::${usage.bindingName}`}
              className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
            >
              <div className="flex flex-col">
                <Link href={routes.agentDefinition(handle, usage.agentId)} className="text-sm font-medium hover:underline">
                  {usage.agentName}
                </Link>
                <span className="text-xs text-muted-foreground font-mono">binding: {usage.bindingName}</span>
              </div>
              {usage.allowedTools !== undefined && usage.allowedTools.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                  <Shield className="h-3 w-3" />
                  {usage.allowedTools.length} allowlisted
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function McpPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;
  const router = useRouter();
  const search = useSearchParams();
  const { canAdmin } = useNamespaceRole(handle);
  const { user, loading: authLoading } = useAuth();

  const [entries, setEntries] = useState<ToolCatalogEntry[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ToolCatalogEntry | null>(null);

  const selectedId = search.get('id');
  const creating = search.get('new') === '1';
  const editing = selectedId === null ? null : (entries.find((entry) => entry.id === selectedId) ?? null);
  const dialogOpen = creating || editing !== null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalog, agentList] = await Promise.all([
        mediforce.toolCatalog.list({ namespace: handle }).then((res) => res.entries),
        mediforce.agents.list({ namespace: handle }).then((res) => res.agents),
      ]);
      setEntries(catalog);
      setAgents(agentList);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers.');
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    // Wait for the session to resolve before fetching — the proxy 401s
    // /api/admin/* requests made before the user is known to be signed in.
    if (authLoading || user === null) return;
    void refresh();
  }, [authLoading, user, refresh]);

  const openEntry = useCallback(
    (id: string) => {
      setFormError(null);
      router.replace(routes.mcp(handle, { id }));
    },
    [handle, router],
  );
  const openCreate = useCallback(() => {
    setFormError(null);
    router.replace(routes.mcp(handle, { create: true }));
  }, [handle, router]);
  const closeDialog = useCallback(() => router.replace(routes.mcp(handle)), [handle, router]);

  const handleSubmit = useCallback(
    async (entry: ToolCatalogEntry) => {
      setFormError(null);
      try {
        if (editing !== null) {
          const { id, type: _type, ...patch } = entry;
          // The form omits an emptied field; null tells the PATCH to clear it.
          const cleared = entry.type === 'stdio'
            ? { args: null, env: null, description: null }
            : { auth: null, description: null };
          await mediforce.toolCatalog.update({ namespace: handle, id, ...cleared, ...patch });
        } else {
          await mediforce.toolCatalog.create({ namespace: handle, ...entry });
        }
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Save failed.');
        throw err;
      }
      closeDialog();
      await refresh();
    },
    [editing, handle, closeDialog, refresh],
  );

  const handleDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    await mediforce.toolCatalog.delete({ namespace: handle, id: deleteTarget.id });
    closeDialog();
    await refresh();
  }, [deleteTarget, handle, closeDialog, refresh]);

  const usageById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, findCatalogUsage(agents, entry.id)])),
    [entries, agents],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter(
      (entry) =>
        matchesQuery(entry.id, needle) ||
        matchesQuery(entry.description, needle) ||
        matchesQuery(entryTarget(entry), needle),
    );
  }, [entries, query]);
  const stdioEntries = filtered.filter((entry) => entry.type === 'stdio');
  const httpEntries = filtered.filter((entry) => entry.type === 'http');

  const renderSection = (title: string, sectionEntries: ToolCatalogEntry[]) => (
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {title}
          <span className="ml-2 text-xs font-normal">({sectionEntries.length})</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sectionEntries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              usages={usageById.get(entry.id) ?? []}
              onOpen={() => openEntry(entry.id)}
            />
          ))}
        </div>
      </section>
    );

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-headline font-semibold" data-tour="mcp-header">MCP</h1>
            <ConceptPopover label="What is an MCP server?">
              <p>
                <strong>An MCP server is an external tool host an agent can call while it runs.</strong>{' '}
                <span className="font-medium text-foreground">Stdio</span> servers are commands the platform launches
                alongside the agent; <span className="font-medium text-foreground">HTTP</span> servers are remote
                endpoints. Both are added here once and bound to agents by id.
              </p>
              <p>
                An agent reaches only the servers bound to it, and a workflow step can narrow that set further —
                never widen it.
              </p>
            </ConceptPopover>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">MCP servers available to agents in @{handle}.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add MCP
          </button>
          {canAdmin && (
            <Link
              href={routes.adminOAuthProviders(handle, { from: 'mcp', create: true })}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Add OAuth provider
            </Link>
          )}
        </div>
      </div>

      <div className="relative mb-6" data-tour="mcp-search">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search MCP servers..."
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
        <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">Loading MCP servers…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Wrench className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {query.trim() === ''
              ? 'No MCP servers configured yet. Add one with “Add MCP”.'
              : 'No MCP servers match your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {stdioEntries.length > 0 && <div data-tour="mcp-stdio">{renderSection('Stdio servers', stdioEntries)}</div>}
          {httpEntries.length > 0 && <div data-tour="mcp-http">{renderSection('HTTP servers', httpEntries)}</div>}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="mt-8 pt-4 border-t text-xs text-muted-foreground">
          {stdioEntries.length} stdio · {httpEntries.length} HTTP · Security levels reflect secret templates, OAuth and
          the tool allowlists configured on agent bindings.
        </div>
      )}

      <Dialog.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <Dialog.Title className="text-base font-semibold">
                {editing !== null ? (
                  <>
                    Edit MCP server <span className="font-mono">{editing.id}</span>
                  </>
                ) : (
                  'Add MCP server'
                )}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button aria-label="Close" className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {dialogOpen && (
                <CatalogForm
                  key={editing?.id ?? 'create'}
                  namespace={handle}
                  entry={editing}
                  onSubmit={handleSubmit}
                  onDelete={editing !== null ? () => setDeleteTarget(editing) : undefined}
                  onCancel={closeDialog}
                  submitError={formError}
                />
              )}
              {editing !== null && <UsedBy handle={handle} usages={usageById.get(editing.id) ?? []} />}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {deleteTarget !== null && (
        <DeleteCatalogEntryDialog
          entryId={deleteTarget.id}
          referenceCount={usageById.get(deleteTarget.id)?.length ?? 0}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
