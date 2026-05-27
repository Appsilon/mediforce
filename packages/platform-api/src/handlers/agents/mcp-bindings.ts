import type {
  UpsertAgentMcpBindingInput,
  UpsertAgentMcpBindingOutput,
  DeleteAgentMcpBindingInput,
  DeleteAgentMcpBindingOutput,
  ListAgentMcpBindingsInput,
  ListAgentMcpBindingsOutput,
} from '../../contract/agents.js';
import type { CallerScope } from '../../repositories/index.js';
import { actorFromCaller, loadOr404 } from '../_helpers.js';

export async function listAgentMcpBindings(
  input: ListAgentMcpBindingsInput,
  scope: CallerScope,
): Promise<ListAgentMcpBindingsOutput> {
  const agent = await loadOr404(scope.agentDefinitions.getById(input.id), 'Agent not found');
  return { mcpServers: agent.mcpServers ?? {} };
}

export async function upsertAgentMcpBinding(
  input: UpsertAgentMcpBindingInput,
  scope: CallerScope,
): Promise<UpsertAgentMcpBindingOutput> {
  const agent = await loadOr404(scope.agentDefinitions.getById(input.id), 'Agent not found');
  const nextMcpServers = { ...(agent.mcpServers ?? {}), [input.name]: input.binding };
  const updated = await scope.agentDefinitions.update(input.id, { mcpServers: nextMcpServers });
  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'agent.mcp_binding_upserted',
    description: `MCP binding '${input.name}' upserted on agent '${updated.name ?? updated.id}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { agentId: input.id, server: input.name },
    outputSnapshot: { servers: Object.keys(updated.mcpServers ?? {}) },
    basis: 'MCP binding upsert via API',
    entityType: 'agentDefinition',
    entityId: updated.id,
  });
  return { mcpServers: updated.mcpServers ?? {} };
}

export async function deleteAgentMcpBinding(
  input: DeleteAgentMcpBindingInput,
  scope: CallerScope,
): Promise<DeleteAgentMcpBindingOutput> {
  const agent = await loadOr404(scope.agentDefinitions.getById(input.id), 'Agent not found');
  const next = { ...(agent.mcpServers ?? {}) };
  delete next[input.name];
  const updated = await scope.agentDefinitions.update(input.id, { mcpServers: next });
  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'agent.mcp_binding_deleted',
    description: `MCP binding '${input.name}' deleted from agent '${updated.name ?? updated.id}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { agentId: input.id, server: input.name },
    outputSnapshot: { servers: Object.keys(updated.mcpServers ?? {}) },
    basis: 'MCP binding delete via API',
    entityType: 'agentDefinition',
    entityId: updated.id,
  });
  return { mcpServers: updated.mcpServers ?? {} };
}
