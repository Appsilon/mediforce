import { mediforce } from './mediforce';
import type { AgentMcpBinding, AgentMcpBindingMap } from '@mediforce/platform-core';

/**
 * Thin typed wrappers over `mediforce.agents.*` MCP binding methods. Kept as
 * a façade so existing call sites don't need to change their import — the
 * underlying call is now the headless typed client.
 */

export async function listAgentBindings(agentId: string): Promise<AgentMcpBindingMap> {
  const { mcpServers } = await mediforce.agents.listMcpBindings({ id: agentId });
  return mcpServers;
}

export async function putAgentBinding(
  agentId: string,
  serverName: string,
  binding: AgentMcpBinding,
): Promise<AgentMcpBindingMap> {
  const { mcpServers } = await mediforce.agents.upsertMcpBinding({
    id: agentId,
    name: serverName,
    binding,
  });
  return mcpServers;
}

export async function deleteAgentBinding(agentId: string, serverName: string): Promise<AgentMcpBindingMap> {
  const { mcpServers } = await mediforce.agents.deleteMcpBinding({
    id: agentId,
    name: serverName,
  });
  return mcpServers;
}
