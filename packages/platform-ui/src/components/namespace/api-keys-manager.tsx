'use client';

import * as React from 'react';
import { Plus, Trash2, Key, ClipboardCopy, Check, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';

interface ApiKeyEntry {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

function CopyKeyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ApiKeysManager() {
  const [keys, setKeys] = React.useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [newKey, setNewKey] = React.useState<{ plaintext: string; id: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = React.useState<string | null>(null);

  const loadKeys = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/api-keys');
      if (!res.ok) return;
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadKeys(); }, [loadKeys]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create key');
        return;
      }
      setNewKey({ plaintext: data.plaintext, id: data.id });
      setLabel('');
      void loadKeys();
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    if (confirmingRevoke !== keyId) {
      setConfirmingRevoke(keyId);
      return;
    }
    setConfirmingRevoke(null);
    setRevoking(keyId);
    try {
      const res = await apiFetch(`/api/api-keys/${keyId}`, { method: 'DELETE' });
      if (res.ok) {
        void loadKeys();
      }
    } catch {
      // ignore
    } finally {
      setRevoking(null);
    }
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => k.revokedAt);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading API keys...</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Personal API keys grant CLI and API access to all workspaces you belong to.
      </p>

      {/* New key reveal */}
      {newKey && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Copy this key now — you won&apos;t see it again.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded bg-muted px-3 py-2 font-mono text-xs break-all">
            <span className="flex-1">{newKey.plaintext}</span>
            <CopyKeyButton text={newKey.plaintext} />
          </div>
          <button
            type="button"
            onClick={() => setNewKey(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Key label (e.g. CI, laptop)"
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          maxLength={128}
        />
        <button
          type="submit"
          disabled={creating || !label.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Create
        </button>
      </form>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Active keys */}
      {activeKeys.length > 0 && (
        <div className="space-y-1">
          {activeKeys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 group">
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{k.label}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{k.keyPrefix}...</span>
                  {' · '}
                  Created {timeAgo(k.createdAt)}
                  {k.lastUsedAt && <>{' · '}Last used {timeAgo(k.lastUsedAt)}</>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {confirmingRevoke === k.id && (
                  <button
                    type="button"
                    onClick={() => setConfirmingRevoke(null)}
                    className="inline-flex items-center rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-all"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRevoke(k.id)}
                  disabled={revoking === k.id}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-all disabled:opacity-50 ${confirmingRevoke === k.id ? 'bg-destructive/10 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <Trash2 className="h-3 w-3" />
                  {confirmingRevoke === k.id ? 'Confirm revoke' : 'Revoke'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeKeys.length === 0 && !newKey && (
        <p className="text-sm text-muted-foreground">No active API keys.</p>
      )}

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">{revokedKeys.length} revoked key{revokedKeys.length > 1 ? 's' : ''}</summary>
          <div className="mt-1 space-y-1 pl-2">
            {revokedKeys.map((k) => (
              <p key={k.id} className="font-mono line-through">{k.keyPrefix}... — {k.label}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
