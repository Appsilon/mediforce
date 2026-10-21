'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { agentImageOf, type AgentVersion } from '@mediforce/platform-core';

/**
 * The exact Agent configuration an Agent's Eval Run assessed (ADR-0029): the
 * Agent version it ran, frozen when the run was prepared, whatever the Agent
 * has become since.
 */
export function AssessedAgentConfiguration({ version }: { version: AgentVersion }) {
  const { config } = version;
  const servers = Object.entries(config.mcpServers);
  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="assessed-agent-configuration">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">Configuration assessed: agent version {version.version}</h2>
        <span className="text-xs text-muted-foreground">
          recorded {format(new Date(version.createdAt), 'yyyy-MM-dd HH:mm')} by {version.createdBy} · <span className="font-mono">{version.hash.slice(0, 12)}</span>
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Runtime</dt>
          <dd className="font-mono text-xs">{config.runtimeId ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Image</dt>
          <dd className="font-mono text-xs">{agentImageOf(config)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Model</dt>
          <dd className="font-mono text-xs">{config.foundationModel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">MCP servers</dt>
          <dd className="text-xs">
            {servers.length === 0 ? 'None' : servers.map(([name, binding]) => (
              <span key={name} className="mr-2 inline-block font-mono">
                {name}{binding.allowedTools === undefined ? '' : ` (${binding.allowedTools.length} tools)`}
              </span>
            ))}
          </dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs text-muted-foreground">Skills</dt>
          <dd className="text-xs">
            {config.skills.length === 0 ? 'None' : config.skills.map((skill) => (
              <span key={`${skill.namespace}/${skill.id}`} className="mr-2 inline-block font-mono" title={skill.contentHash}>
                {skill.namespace}/{skill.id} @ {skill.contentHash.slice(0, 8)}
              </span>
            ))}
          </dd>
        </div>
      </dl>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">System prompt</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{config.systemPrompt}</pre>
      </details>
    </section>
  );
}
