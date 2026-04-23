'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Link2Off,
  Loader2,
  LogIn,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  disconnectOAuthToken,
  listAgentOAuthTokens,
  startOAuthFlow,
  type AgentOAuthTokenStatus,
} from '@/lib/agent-oauth-client';

interface OAuthConnectionStatusProps {
  agentId: string;
  serverName: string;
  /** Provider id (references `namespaces/{h}/oauthProviders/{providerId}`). */
  provider: string;
  /** Namespace handle. Surfaced in props so the component can re-fetch
   *  scoped to the right namespace. Reserved for when the underlying client
   *  wrappers accept namespace. */
  namespace: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; token: AgentOAuthTokenStatus | null }
  | { kind: 'error'; message: string };

export function OAuthConnectionStatus({
  agentId,
  serverName,
  provider,
  namespace,
}: OAuthConnectionStatusProps) {
  const router = useRouter();
  const search = useSearchParams();

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoadState({ kind: 'loading' });
    try {
      const tokens = await listAgentOAuthTokens(agentId, namespace);
      const match = tokens.find(
        (entry) => entry.serverName === serverName && entry.provider === provider,
      );
      setLoadState({ kind: 'loaded', token: match ?? null });
    } catch (err: unknown) {
      setLoadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load connection status.',
      });
    }
  }, [agentId, serverName, provider, namespace]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Post-callback ?connected=<serverName> query — show success toast and
  // strip the param so a reload doesn't re-trigger it.
  useEffect(() => {
    const connected = search.get('connected');
    if (connected === null) return;
    if (connected !== serverName) return;

    setSuccessMessage(`Connected to ${provider}.`);

    const qs = new URLSearchParams(search.toString());
    qs.delete('connected');
    const next = qs.toString();
    router.replace(next === '' ? window.location.pathname : `${window.location.pathname}?${next}`);
  }, [search, serverName, provider, router]);

  async function handleConnect() {
    setMutationError(null);
    setMutating(true);
    try {
      const { authorizeUrl } = await startOAuthFlow(agentId, provider, serverName, namespace);
      window.location.href = authorizeUrl;
    } catch (err: unknown) {
      setMutationError(err instanceof Error ? err.message : 'Failed to start OAuth flow.');
      setMutating(false);
    }
  }

  async function handleDisconnect() {
    setMutationError(null);
    setMutating(true);
    try {
      await disconnectOAuthToken(agentId, provider, serverName, namespace, {
        revokeAtProvider: false,
      });
      await refresh();
    } catch (err: unknown) {
      setMutationError(err instanceof Error ? err.message : 'Failed to disconnect.');
    } finally {
      setMutating(false);
    }
  }

  async function handleRevokeConfirm() {
    setMutationError(null);
    setMutating(true);
    // Close dialog BEFORE awaiting — Radix deadlock rule.
    setRevokeOpen(false);
    try {
      await disconnectOAuthToken(agentId, provider, serverName, namespace, {
        revokeAtProvider: true,
      });
      await refresh();
    } catch (err: unknown) {
      setMutationError(err instanceof Error ? err.message : 'Failed to revoke.');
    } finally {
      setMutating(false);
    }
  }

  if (loadState.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking connection…
      </div>
    );
  }

  if (loadState.kind === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{loadState.message}</span>
      </div>
    );
  }

  const token = loadState.token;

  return (
    <div className="flex flex-col gap-2">
      {successMessage !== null && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMessage}
        </div>
      )}

      {mutationError !== null && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{mutationError}</span>
        </div>
      )}

      {token === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Link2Off className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Not connected</span>
            <span className="text-muted-foreground">— no OAuth token for this binding</span>
          </div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={mutating}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="h-3.5 w-3.5" />
            )}
            Connect
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Link2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">
              Connected as <span className="font-mono">@{token.accountLogin}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={mutating}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={() => setRevokeOpen(true)}
              disabled={mutating}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              Revoke
            </button>
          </div>
        </div>
      )}

      <Dialog.Root
        open={revokeOpen}
        onOpenChange={(open) => {
          if (mutating) return;
          setRevokeOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Revoke OAuth token
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  disabled={mutating}
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-sm text-muted-foreground">
              Revokes the local token AND calls the provider&apos;s revoke endpoint. The OAuth grant
              will no longer appear on your account at{' '}
              <span className="font-mono text-foreground">{provider}</span>.
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevokeOpen(false)}
                disabled={mutating}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevokeConfirm}
                disabled={mutating}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {mutating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Revoke
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
