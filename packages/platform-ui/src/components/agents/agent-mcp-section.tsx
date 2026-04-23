'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Pencil, Plus, Server, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentMcpBinding, AgentMcpBindingMap, ToolCatalogEntry } from '@mediforce/platform-core';
import {
  deleteAgentBinding,
  listAgentBindings,
  putAgentBinding,
} from '@/lib/agent-mcp-client';
import { listCatalogEntries } from '@/lib/mcp-admin-client';
import { AgentMcpBindingForm } from './agent-mcp-binding-form';

interface AgentMcpSectionProps {
  agentId: string;
  handle: string;
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; name: string; binding: AgentMcpBinding };

export function AgentMcpSection({ agentId, handle }: AgentMcpSectionProps) {
  const [bindings, setBindings] = useState<AgentMcpBindingMap>({});
  const [catalog, setCatalog] = useState<ToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<{ name: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [serverBindings, catalogEntries] = await Promise.all([
        listAgentBindings(agentId),
        listCatalogEntries(handle).catch(() => [] as ToolCatalogEntry[]),
      ]);
      setBindings(serverBindings);
      setCatalog(catalogEntries);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP bindings.');
    } finally {
      setLoading(false);
    }
  }, [agentId, handle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const existingNames = useMemo(() => Object.keys(bindings), [bindings]);

  const handleSubmit = useCallback(
    async (name: string, binding: AgentMcpBinding) => {
      setError(null);
      const updated = await putAgentBinding(agentId, name, binding);
      setBindings(updated);
      setDialog({ kind: 'closed' });
    },
    [agentId],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    setError(null);
    // Close the dialog BEFORE the async work so React 18 can unmount it
    // while the HTTP call is in flight (see Journey 1 learning).
    setDeleteTarget(null);
    try {
      const updated = await deleteAgentBinding(agentId, target.name);
      setBindings(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  }, [deleteTarget, agentId]);

  const entries = Object.entries(bindings);

  return (
    <section className="space-y-3 rounded-lg border bg-card px-4 py-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">MCP Servers</h2>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ kind: 'create' })}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add server
        </button>
      </header>

      <p className="text-xs text-muted-foreground">
        Tools this agent can invoke via MCP. Stdio bindings pull from the namespace catalog; HTTP
        bindings point at external endpoints. Workflow steps may further narrow via{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">denyTools</code>.
      </p>

      {error !== null && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground animate-pulse">
          Loading…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-center">
          <p className="text-sm font-medium">No MCP bindings yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a server to let this agent call external tools over stdio or HTTP.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map(([name, binding]) => (
            <BindingRow
              key={name}
              name={name}
              binding={binding}
              onEdit={() => setDialog({ kind: 'edit', name, binding })}
              onRemove={() => setDeleteTarget({ name })}
            />
          ))}
        </ul>
      )}

      {/* Add / Edit dialog ---------------------------------------------- */}
      <Dialog.Root
        open={dialog.kind !== 'closed'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'closed' });
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <Dialog.Title className="text-base font-semibold">
                {dialog.kind === 'edit' ? (
                  <>
                    Edit binding <span className="font-mono">{dialog.name}</span>
                  </>
                ) : (
                  'Add MCP server'
                )}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {dialog.kind !== 'closed' && (
                <AgentMcpBindingForm
                  key={dialog.kind === 'edit' ? `edit:${dialog.name}` : 'create'}
                  existing={dialog.kind === 'edit' ? { name: dialog.name, binding: dialog.binding } : null}
                  existingNames={existingNames}
                  catalogEntries={catalog}
                  agentId={agentId}
                  namespace={handle}
                  onSubmit={handleSubmit}
                  onCancel={() => setDialog({ kind: 'closed' })}
                />
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Delete dialog --------------------------------------------------- */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Remove binding
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            {deleteTarget !== null && (
              <Dialog.Description className="text-sm text-muted-foreground">
                Remove <span className="font-mono text-foreground">{deleteTarget.name}</span> from this agent. Workflow
                steps that referenced this server via{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">mcpRestrictions</code> will no longer
                resolve a server by that name.
              </Dialog.Description>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

// ── Single binding row ──────────────────────────────────────────────────────

function BindingRow({
  name,
  binding,
  onEdit,
  onRemove,
}: {
  name: string;
  binding: AgentMcpBinding;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const transportLabel = binding.type === 'stdio' ? 'stdio' : 'HTTP';
  const detail =
    binding.type === 'stdio'
      ? `catalogId: ${binding.catalogId}`
      : truncateUrl(binding.url);
  const allowedCount = binding.allowedTools?.length ?? 0;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border bg-background px-3 py-2">
      <span className="font-mono text-sm font-semibold">{name}</span>
      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {transportLabel}
      </span>
      <span className="text-xs text-muted-foreground font-mono truncate max-w-[30ch]" title={detail}>
        {detail}
      </span>
      {allowedCount > 0 && (
        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {allowedCount} allowlisted
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Edit ${name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
          aria-label={`Remove ${name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}
