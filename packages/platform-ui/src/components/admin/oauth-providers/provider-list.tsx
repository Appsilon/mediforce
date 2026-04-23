'use client';

import { KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OAuthProviderConfig } from '@mediforce/platform-core';

interface ProviderListProps {
  providers: OAuthProviderConfig[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Redacts the middle of a client id for display — preserves first/last few
 *  characters so admins can identify which app the row corresponds to
 *  without exposing the full value. Short ids (<=8 chars) show unchanged. */
export function redactClientId(clientId: string): string {
  if (clientId.length <= 8) return clientId;
  const head = clientId.slice(0, 4);
  const tail = clientId.slice(-4);
  return `${head}…${tail}`;
}

export function ProviderList({ providers, selectedId, onSelect }: ProviderListProps) {
  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No OAuth providers yet.</p>
        <p className="text-xs text-muted-foreground">
          Add one to enable OAuth-backed HTTP MCP bindings.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {providers.map((provider) => {
        const isSelected = provider.id === selectedId;
        return (
          <li key={provider.id}>
            <button
              type="button"
              onClick={() => onSelect(provider.id)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                isSelected && 'bg-muted',
              )}
            >
              {provider.iconUrl !== undefined ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={provider.iconUrl}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                  <KeyRound className="h-3.5 w-3.5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">{provider.id}</span>
                  <span className="text-xs text-muted-foreground">{provider.name}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  <span className="font-mono">client: {redactClientId(provider.clientId)}</span>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
