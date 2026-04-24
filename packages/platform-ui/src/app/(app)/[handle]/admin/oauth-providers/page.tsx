'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Plus } from 'lucide-react';
import type { AgentDefinition, OAuthProviderConfig } from '@mediforce/platform-core';
import { OAUTH_PROVIDER_PRESETS } from '@mediforce/platform-core';
import { apiFetch } from '@/lib/api-fetch';
import {
  createOAuthProvider,
  deleteOAuthProvider,
  listOAuthProviders,
  updateOAuthProvider,
} from '@/lib/oauth-admin-client';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { ProviderList } from '@/components/admin/oauth-providers/provider-list';
import { ProviderForm } from '@/components/admin/oauth-providers/provider-form';
import { DeleteProviderDialog } from '@/components/admin/oauth-providers/delete-provider-dialog';

type PresetKey = keyof typeof OAUTH_PROVIDER_PRESETS;

type FormMode =
  | { kind: 'idle' }
  | { kind: 'create'; preset: PresetKey | null }
  | { kind: 'edit'; provider: OAuthProviderConfig };

export default function AdminOAuthProvidersPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const router = useRouter();
  const search = useSearchParams();
  const { canAdmin, loading: roleLoading } = useNamespaceRole(handle);

  const [providers, setProviders] = useState<OAuthProviderConfig[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<FormMode>({ kind: 'idle' });
  const [deleteTarget, setDeleteTarget] = useState<OAuthProviderConfig | null>(null);

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
        listOAuthProviders(handle),
        apiFetch('/api/agent-definitions').then(async (res) =>
          res.ok ? ((await res.json()) as { agents: AgentDefinition[] }).agents : [],
        ),
      ]);
      setProviders(fetched);
      setAgents(agentRes);
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load providers.');
    } finally {
      setListLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    if (canAdmin) void refresh();
  }, [canAdmin, refresh]);

  const selectedId = search.get('id');
  useEffect(() => {
    if (selectedId === null) {
      setMode((current) => (current.kind === 'edit' ? { kind: 'idle' } : current));
      return;
    }
    const match = providers.find((provider) => provider.id === selectedId);
    if (match !== undefined) {
      setMode({ kind: 'edit', provider: match });
    }
  }, [selectedId, providers]);

  const handleSelect = useCallback(
    (id: string) => {
      const qs = new URLSearchParams(search.toString());
      qs.set('id', id);
      router.replace(`/${handle}/admin/oauth-providers?${qs.toString()}`);
    },
    [handle, router, search],
  );

  const clearSelectionQuery = useCallback(() => {
    const qs = new URLSearchParams(search.toString());
    qs.delete('id');
    const url = qs.toString() !== '' ? `/${handle}/admin/oauth-providers?${qs.toString()}` : `/${handle}/admin/oauth-providers`;
    router.replace(url);
  }, [handle, router, search]);

  const handleNew = useCallback(
    (preset: PresetKey | null) => {
      clearSelectionQuery();
      setMode({ kind: 'create', preset });
      setFormError(null);
    },
    [clearSelectionQuery],
  );

  const handleSubmit = useCallback(
    async (payload: Omit<OAuthProviderConfig, 'createdAt' | 'updatedAt'>) => {
      setFormError(null);
      try {
        if (mode.kind === 'edit') {
          const { id: _id, ...patch } = payload;
          await updateOAuthProvider(handle, mode.provider.id, patch);
        } else {
          await createOAuthProvider(handle, payload);
          const qs = new URLSearchParams(search.toString());
          qs.set('id', payload.id);
          router.replace(`/${handle}/admin/oauth-providers?${qs.toString()}`);
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
        if (
          binding.type === 'http' &&
          binding.auth?.type === 'oauth' &&
          binding.auth.provider === deleteTarget.id
        ) {
          return count + 1;
        }
      }
      return count;
    }, 0);
  }, [agents, deleteTarget]);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    clearSelectionQuery();
    setMode({ kind: 'idle' });
    setDeleteTarget(null);
    try {
      await deleteOAuthProvider(handle, target.id);
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Delete failed.');
    }
    await refresh();
  }, [deleteTarget, handle, refresh, clearSelectionQuery]);

  if (roleLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!canAdmin) {
    return null;
  }

  const currentPreset = mode.kind === 'create' ? mode.preset : null;
  const editingProvider = mode.kind === 'edit' ? mode.provider : null;

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
            <h1 className="text-xl font-semibold">OAuth providers</h1>
            <p className="text-sm text-muted-foreground">
              OAuth2 providers available for HTTP MCP bindings in @{handle}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleNew('github')}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Add GitHub
            </button>
            <button
              type="button"
              onClick={() => handleNew('google')}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Google
            </button>
            <button
              type="button"
              onClick={() => handleNew(null)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add custom
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
            {listLoading ? (
              <div className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground animate-pulse">
                Loading…
              </div>
            ) : (
              <ProviderList
                providers={providers}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          </aside>

          <section className="rounded-lg border bg-card px-5 py-5">
            {mode.kind === 'idle' && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
                <p className="text-sm font-medium">
                  {providers.length === 0 ? 'No OAuth providers yet.' : 'Select a provider to edit.'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {providers.length === 0
                    ? 'Add your first provider — GitHub or Google presets, or a custom OAuth2 endpoint.'
                    : 'Or add a new provider from the buttons above.'}
                </p>
              </div>
            )}

            {mode.kind === 'create' && (
              <>
                <h2 className="mb-4 text-base font-semibold">
                  {currentPreset !== null
                    ? `New ${OAUTH_PROVIDER_PRESETS[currentPreset].name} provider`
                    : 'New OAuth provider'}
                </h2>
                <ProviderForm
                  key={currentPreset ?? 'custom'}
                  provider={null}
                  preset={currentPreset}
                  onSubmit={handleSubmit}
                  submitError={formError}
                />
              </>
            )}

            {mode.kind === 'edit' && editingProvider !== null && (
              <>
                <h2 className="mb-4 text-base font-semibold">
                  Edit <span className="font-mono">{editingProvider.id}</span>
                </h2>
                <ProviderForm
                  key={editingProvider.id}
                  provider={editingProvider}
                  preset={null}
                  onSubmit={handleSubmit}
                  onDelete={() => setDeleteTarget(editingProvider)}
                  submitError={formError}
                />
              </>
            )}
          </section>
        </div>
      </div>

      {deleteTarget !== null && (
        <DeleteProviderDialog
          providerId={deleteTarget.id}
          providerName={deleteTarget.name}
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
