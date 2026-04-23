'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Lock, Plug, Shield, Terminal, Users } from 'lucide-react';
import type { AgentDefinition, ToolCatalogEntry } from '@mediforce/platform-core';
import { apiFetch } from '@/lib/api-fetch';
import { getCatalogEntry } from '@/lib/mcp-admin-client';

export default function ToolDetailPage() {
  const params = useParams<{ handle: string; toolId: string }>();
  const handle = params.handle;
  const toolId = params.toolId;

  const [entry, setEntry] = useState<ToolCatalogEntry | null>(null);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedEntry, agentList] = await Promise.all([
        getCatalogEntry(handle, toolId),
        apiFetch('/api/agent-definitions').then(async (res) =>
          res.ok ? ((await res.json()) as { agents: AgentDefinition[] }).agents : [],
        ),
      ]);
      setEntry(fetchedEntry);
      setAgents(agentList);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tool.');
    } finally {
      setLoading(false);
    }
  }, [handle, toolId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const usingAgents = useMemo(() => {
    if (entry === null) return [];
    const rows: { agent: AgentDefinition; bindingName: string; allowedTools?: string[] }[] = [];
    for (const agent of agents) {
      const bindings = agent.mcpServers ?? {};
      for (const [name, binding] of Object.entries(bindings)) {
        if (binding.type === 'stdio' && binding.catalogId === entry.id) {
          rows.push({ agent, bindingName: name, allowedTools: binding.allowedTools });
        }
      }
    }
    return rows;
  }, [entry, agents]);

  const secretEntries = useMemo(
    () => (entry?.env ? Object.entries(entry.env) : []),
    [entry],
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
        <p className="text-sm text-destructive">{error}</p>
        <Link href={`/${handle}/tools`} className="text-sm text-primary hover:underline">
          Back to Tools
        </Link>
      </div>
    );
  }

  if (entry === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Tool not found.</p>
        <Link href={`/${handle}/tools`} className="mt-2 text-sm text-primary hover:underline">
          Back to Tools
        </Link>
      </div>
    );
  }

  const command = `${entry.command}${entry.args && entry.args.length > 0 ? ' ' + entry.args.join(' ') : ''}`;

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href={`/${handle}/tools`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Tools
        </Link>

        <div className="mb-8">
          <h1 className="text-xl font-headline font-semibold font-mono">{entry.id}</h1>
          {entry.description !== undefined && (
            <p className="text-sm text-muted-foreground mt-1">{entry.description}</p>
          )}
        </div>

        <div className="rounded-lg border bg-card px-4 py-5 mb-6">
          <h2 className="text-sm font-semibold mb-3">Connection</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Plug className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Transport:</span>
              <span className="text-xs font-medium">stdio</span>
            </div>
            <div className="flex items-start gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <span className="text-xs text-muted-foreground">Command:</span>
                <code className="ml-2 text-xs font-mono bg-muted px-2 py-1 rounded">{command}</code>
              </div>
            </div>
          </div>
        </div>

        {secretEntries.length > 0 && (
          <div className="rounded-lg border bg-card px-4 py-5 mb-6">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-500" />
              Environment variables
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Values containing <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">{'{{SECRET:name}}'}</code> are
              resolved at runtime against the workflow secrets.
            </p>
            <div className="space-y-2">
              {secretEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    <code className="text-sm font-mono">{key}</code>
                  </div>
                  <code className="text-[11px] font-mono text-muted-foreground">{value}</code>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border bg-card px-4 py-5 mb-6">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Used by agents
          </h2>
          {usingAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No agent bindings reference this entry yet. Go to an agent editor → <em>MCP Servers</em> to bind it.
            </p>
          ) : (
            <ul className="space-y-2">
              {usingAgents.map(({ agent, bindingName, allowedTools }) => (
                <li
                  key={`${agent.id}::${bindingName}`}
                  className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
                >
                  <div className="flex flex-col">
                    <Link
                      href={`/${handle}/agents/definitions/${agent.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {agent.name}
                    </Link>
                    <span className="text-xs text-muted-foreground font-mono">binding: {bindingName}</span>
                  </div>
                  {allowedTools !== undefined && allowedTools.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                      <Shield className="h-3 w-3" />
                      {allowedTools.length} allowlisted
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border bg-card px-4 py-5">
          <h2 className="text-sm font-semibold mb-3">Usage in agent definition</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Reference this entry via <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">mcpServers</code> on
            an AgentDefinition:
          </p>
          <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
{JSON.stringify(
  {
    mcpServers: {
      [entry.id]: {
        type: 'stdio',
        catalogId: entry.id,
      },
    },
  },
  null,
  2,
)}
          </pre>
        </div>
      </div>
    </div>
  );
}
