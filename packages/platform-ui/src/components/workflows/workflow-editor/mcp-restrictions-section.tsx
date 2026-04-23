'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, X } from 'lucide-react';
import type { AgentMcpBindingMap, StepMcpRestriction } from '@mediforce/platform-core';
import { listAgentBindings } from '@/lib/agent-mcp-client';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { Section } from './step-editor-fields';
import { applyRestrictionUpdate } from './mcp-restrictions-helpers';

interface McpRestrictionsSectionProps {
  agentId: string;
  restrictions: StepMcpRestriction | undefined;
  onChange: (next: StepMcpRestriction | undefined) => void;
}

export function McpRestrictionsSection({ agentId, restrictions, onChange }: McpRestrictionsSectionProps) {
  const { firebaseUser, loading: authLoading } = useAuth();
  const [bindings, setBindings] = useState<AgentMcpBindingMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for Firebase auth to settle — middleware 401s /api/agent-definitions
    // without a Bearer token when the user is signed in as a Firebase user.
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAgentBindings(agentId)
      .then((result) => {
        if (!cancelled) setBindings(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load agent bindings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, authLoading, firebaseUser]);

  const updateEntry = useCallback(
    (serverName: string, patch: Partial<{ disable: boolean; denyTools: string[] }>) => {
      onChange(applyRestrictionUpdate(restrictions, serverName, patch));
    },
    [restrictions, onChange],
  );

  const bindingEntries = Object.entries(bindings);

  return (
    <Section title="MCP Restrictions">
      {loading ? (
        <p className="text-[11px] text-muted-foreground animate-pulse">Loading bindings…</p>
      ) : error !== null ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : bindingEntries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Agent has no MCP servers to restrict. Add a binding on the agent editor first.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Subtractive — disable a server on this step, or deny specific tools exposed by it. Cannot broaden the
            agent&apos;s allowlist.
          </p>
          {bindingEntries.map(([name, binding]) => {
            const entry = restrictions?.[name];
            const disabled = entry?.disable === true;
            const denyTools = entry?.denyTools ?? [];
            return (
              <ServerRow
                key={name}
                name={name}
                transport={binding.type}
                disabled={disabled}
                denyTools={denyTools}
                onToggleDisable={(next) => updateEntry(name, { disable: next })}
                onAddDenyTool={(tool) =>
                  updateEntry(name, { denyTools: [...denyTools.filter((existing) => existing !== tool), tool] })
                }
                onRemoveDenyTool={(tool) => updateEntry(name, { denyTools: denyTools.filter((existing) => existing !== tool) })}
              />
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ── Per-server row ──────────────────────────────────────────────────────────

function ServerRow({
  name,
  transport,
  disabled,
  denyTools,
  onToggleDisable,
  onAddDenyTool,
  onRemoveDenyTool,
}: {
  name: string;
  transport: 'stdio' | 'http';
  disabled: boolean;
  denyTools: string[];
  onToggleDisable: (next: boolean) => void;
  onAddDenyTool: (tool: string) => void;
  onRemoveDenyTool: (tool: string) => void;
}) {
  const [draft, setDraft] = useState('');

  function commitDraft() {
    const value = draft.trim();
    if (value === '') return;
    onAddDenyTool(value);
    setDraft('');
  }

  return (
    <div className={cn('rounded-md border px-2.5 py-2', disabled ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20' : 'border-border/60')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-semibold truncate">{name}</span>
          <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {transport}
          </span>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            checked={disabled}
            onChange={(event) => onToggleDisable(event.target.checked)}
            aria-label={`Disable ${name}`}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          <span className="text-muted-foreground">Disable</span>
        </label>
      </div>

      <div className="mt-2">
        <p className="text-[10px] text-muted-foreground mb-1">Deny tools</p>
        <div className="flex flex-wrap items-center gap-1">
          {denyTools.map((tool) => (
            <span
              key={tool}
              className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-mono text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
            >
              <Ban className="h-2.5 w-2.5" />
              {tool}
              <button
                type="button"
                onClick={() => onRemoveDenyTool(tool)}
                aria-label={`Remove denied tool ${tool}`}
                className="rounded-full p-0.5 hover:bg-red-100 dark:hover:bg-red-900"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            aria-label={`Deny tool for ${name}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                commitDraft();
              }
            }}
            onBlur={commitDraft}
            placeholder="deny tool name…"
            className="flex-1 min-w-[10ch] bg-transparent text-[11px] font-mono border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors placeholder:text-muted-foreground/60 placeholder:italic"
          />
        </div>
      </div>
    </div>
  );
}

