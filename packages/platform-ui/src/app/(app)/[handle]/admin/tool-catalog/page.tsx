'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import type { AgentDefinition, ToolCatalogEntry } from '@mediforce/platform-core';
import { apiFetch } from '@/lib/api-fetch';
import {
  createCatalogEntry,
  deleteCatalogEntry,
  listCatalogEntries,
  updateCatalogEntry,
} from '@/lib/mcp-admin-client';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { CatalogList } from '@/components/admin/tool-catalog/catalog-list';
import { CatalogForm } from '@/components/admin/tool-catalog/catalog-form';
import { DeleteCatalogEntryDialog } from '@/components/admin/tool-catalog/delete-catalog-entry-dialog';

type FormMode = { kind: 'idle' } | { kind: 'create' } | { kind: 'edit'; entry: ToolCatalogEntry };

export default function AdminToolCatalogPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const router = useRouter();
  const search = useSearchParams();
  const { canAdmin, loading: roleLoading } = useNamespaceRole(handle);

  const [entries, setEntries] = useState<ToolCatalogEntry[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<FormMode>({ kind: 'idle' });
  const [deleteTarget, setDeleteTarget] = useState<ToolCatalogEntry | null>(null);

  // Role gate — redirect non-admin/non-owner once resolved
  useEffect(() => {
    if (!roleLoading && !canAdmin) {
      router.replace(`/${handle}`);
    }
  }, [roleLoading, canAdmin, handle, router]);

  const refresh = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const [fetched, agentRes] = await Promise.all([
        listCatalogEntries(handle),
        apiFetch('/api/agent-definitions').then(async (res) =>
          res.ok ? ((await res.json()) as { agents: AgentDefinition[] }).agents : [],
        ),
      ]);
      setEntries(fetched);
      setAgents(agentRes);
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load catalog.');
    } finally {
      setListLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    if (canAdmin) void refresh();
  }, [canAdmin, refresh]);

  // Sync selected entry with ?id= query
  const selectedId = search.get('id');
  useEffect(() => {
    if (selectedId === null) {
      setMode((current) => (current.kind === 'edit' ? { kind: 'idle' } : current));
      return;
    }
    const match = entries.find((entry) => entry.id === selectedId);
    if (match !== undefined) {
      setMode({ kind: 'edit', entry: match });
    }
  }, [selectedId, entries]);

  const handleSelect = useCallback(
    (id: string) => {
      const qs = new URLSearchParams(search.toString());
      qs.set('id', id);
      router.replace(`/${handle}/admin/tool-catalog?${qs.toString()}`);
    },
    [handle, router, search],
  );

  const handleNew = useCallback(() => {
    const qs = new URLSearchParams(search.toString());
    qs.delete('id');
    const url = qs.toString() !== '' ? `/${handle}/admin/tool-catalog?${qs.toString()}` : `/${handle}/admin/tool-catalog`;
    router.replace(url);
    setMode({ kind: 'create' });
    setFormError(null);
  }, [handle, router, search]);

  const handleSubmit = useCallback(
    async (entry: ToolCatalogEntry) => {
      setFormError(null);
      try {
        if (mode.kind === 'edit') {
          const { id, ...patch } = entry;
          await updateCatalogEntry(handle, id, patch);
        } else {
          await createCatalogEntry(handle, entry);
          const qs = new URLSearchParams(search.toString());
          qs.set('id', entry.id);
          router.replace(`/${handle}/admin/tool-catalog?${qs.toString()}`);
        }
        await refresh();
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Save failed.');
        throw err;
      }
    },
    [mode, handle, refresh, router, search],
  );

  const referenceCount = useMemo(() => {
    if (deleteTarget === null) return 0;
    return agents.reduce((count, agent) => {
      const bindings = agent.mcpServers ?? {};
      for (const binding of Object.values(bindings)) {
        if (binding.type === 'stdio' && binding.catalogId === deleteTarget.id) {
          return count + 1;
        }
      }
      return count;
    }, 0);
  }, [agents, deleteTarget]);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    // Close the dialog and clear selection up-front so the UI responds
    // immediately; failures surface as a page-level listError via refresh().
    const qs = new URLSearchParams(search.toString());
    qs.delete('id');
    const url = qs.toString() !== '' ? `/${handle}/admin/tool-catalog?${qs.toString()}` : `/${handle}/admin/tool-catalog`;
    router.replace(url);
    setMode({ kind: 'idle' });
    setDeleteTarget(null);
    try {
      await deleteCatalogEntry(handle, target.id);
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Delete failed.');
    }
    await refresh();
  }, [deleteTarget, handle, refresh, router, search]);

  if (roleLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!canAdmin) {
    // Redirect effect above handles navigation; render nothing to avoid flash.
    return null;
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href={`/${handle}`}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Tool catalog</h1>
            <p className="text-sm text-muted-foreground">
              Curated stdio MCP servers available to agents in @{handle}.
            </p>
          </div>
          <button
            type="button"
            onClick={handleNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New catalog entry
          </button>
        </div>

        {listError !== null && (
          <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {listError}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-[1fr_1.5fr]">
          <aside>
            {listLoading ? (
              <div className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground animate-pulse">
                Loading…
              </div>
            ) : (
              <CatalogList entries={entries} selectedId={selectedId} onSelect={handleSelect} />
            )}
          </aside>

          <section className="rounded-lg border bg-card px-5 py-5">
            {mode.kind === 'idle' && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
                <p className="text-sm font-medium">
                  {entries.length === 0 ? 'No catalog entries yet.' : 'Select an entry to edit.'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entries.length === 0
                    ? 'Add your first entry to get started.'
                    : 'Or click “New catalog entry” above to add another.'}
                </p>
                {entries.length === 0 && (
                  <button
                    type="button"
                    onClick={handleNew}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New catalog entry
                  </button>
                )}
              </div>
            )}

            {mode.kind === 'create' && (
              <>
                <h2 className="mb-4 text-base font-semibold">New catalog entry</h2>
                <CatalogForm entry={null} onSubmit={handleSubmit} submitError={formError} />
              </>
            )}

            {mode.kind === 'edit' && (
              <>
                <h2 className="mb-4 text-base font-semibold">
                  Edit <span className="font-mono">{mode.entry.id}</span>
                </h2>
                <CatalogForm
                  key={mode.entry.id}
                  entry={mode.entry}
                  onSubmit={handleSubmit}
                  onDelete={() => setDeleteTarget(mode.entry)}
                  submitError={formError}
                />
              </>
            )}
          </section>
        </div>
      </div>

      {deleteTarget !== null && (
        <DeleteCatalogEntryDialog
          entryId={deleteTarget.id}
          referenceCount={referenceCount}
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
