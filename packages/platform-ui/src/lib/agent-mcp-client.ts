import { apiFetch } from './api-fetch';
import type { AgentMcpBinding, AgentMcpBindingMap } from '@mediforce/platform-core';

/**
 * Thin typed wrappers over `/api/agent-definitions/:id/mcp-servers` REST surface.
 * All calls attach the Firebase ID token via `apiFetch`.
 *
 * When #232's generated API client lands, this module becomes a mechanical
 * re-export of those clients — keep the call sites going through these helpers.
 */

async function parseOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${label} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listAgentBindings(agentId: string): Promise<AgentMcpBindingMap> {
  const res = await apiFetch(`/api/agent-definitions/${encodeURIComponent(agentId)}/mcp-servers`);
  const { mcpServers } = await parseOrThrow<{ mcpServers: AgentMcpBindingMap }>(res, 'List agent bindings');
  return mcpServers;
}

export async function putAgentBinding(
  agentId: string,
  serverName: string,
  binding: AgentMcpBinding,
): Promise<AgentMcpBindingMap> {
  const res = await apiFetch(
    `/api/agent-definitions/${encodeURIComponent(agentId)}/mcp-servers/${encodeURIComponent(serverName)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(binding),
    },
  );
  const { mcpServers } = await parseOrThrow<{ mcpServers: AgentMcpBindingMap }>(res, 'Save agent binding');
  return mcpServers;
}

export async function deleteAgentBinding(
  agentId: string,
  serverName: string,
): Promise<AgentMcpBindingMap> {
  const res = await apiFetch(
    `/api/agent-definitions/${encodeURIComponent(agentId)}/mcp-servers/${encodeURIComponent(serverName)}`,
    { method: 'DELETE' },
  );
  const { mcpServers } = await parseOrThrow<{ mcpServers: AgentMcpBindingMap }>(res, 'Delete agent binding');
  return mcpServers;
}
