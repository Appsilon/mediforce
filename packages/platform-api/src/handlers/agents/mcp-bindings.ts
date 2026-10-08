import type { AgentMcpBinding, AgentMcpBindingMap } from '@mediforce/platform-core';
import type {
  UpsertAgentMcpBindingInput,
  UpsertAgentMcpBindingOutput,
  DeleteAgentMcpBindingInput,
  DeleteAgentMcpBindingOutput,
  ListAgentMcpBindingsInput,
  ListAgentMcpBindingsOutput,
} from '../../contract/agents';
import type { CallerScope } from '../../repositories/index';
import { HandlerError, PreconditionFailedError } from '../../errors';
import { actorFromCaller, loadOr404, resolvePersonalNamespace } from '../_helpers';

/**
 * The FK-valid `workspace` an MCP-binding audit event belongs to. A
 * namespace-bound agent's own namespace owns the event; for a platform-global
 * agent (no namespace) the acting user's personal namespace owns it. apiKey
 * callers editing a global agent have no namespace to attribute to — reject
 * loudly rather than letting the Postgres NOT-NULL audit write throw.
 */
async function actingNamespace(
  scope: CallerScope,
  agentNamespace: string | undefined,
): Promise<string> {
  if (agentNamespace !== undefined) return agentNamespace;
  if (scope.caller.kind === 'user') {
    const personal = await resolvePersonalNamespace(scope, scope.caller.uid);
    if (personal !== null) return personal;
  }
  throw new PreconditionFailedError(
    'Cannot attribute MCP-binding audit event to a workspace: the agent is ' +
      'platform-global and the caller has no namespace.',
  );
}

/**
 * A binding may only point at a server that already exists in the agent's
 * workspace catalog, with the transport it declares. Platform-global agents
 * have no workspace catalog to check against; the runtime resolver checks
 * them against the running workflow's namespace.
 */
export async function assertBindingsTargetCatalogEntries(
  scope: CallerScope,
  namespace: string | undefined,
  bindings: AgentMcpBindingMap | undefined,
): Promise<void> {
  if (namespace === undefined) return;
  for (const binding of Object.values(bindings ?? {})) {
    await assertBindingTargetsCatalogEntry(scope, namespace, binding);
  }
}

async function assertBindingTargetsCatalogEntry(
  scope: CallerScope,
  namespace: string,
  binding: AgentMcpBinding,
): Promise<void> {
  const entry = await scope.toolCatalog.getById(namespace, binding.catalogId);
  if (entry === null) {
    throw new HandlerError(
      'validation',
      `Tool catalog of "${namespace}" has no MCP server "${binding.catalogId}". Add it on the MCP page first.`,
    );
  }
  if (entry.type !== binding.type) {
    throw new HandlerError(
      'validation',
      `MCP server "${binding.catalogId}" is ${entry.type}, but the binding declares ${binding.type}.`,
    );
  }
}

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
  await assertBindingsTargetCatalogEntries(scope, agent.namespace, { [input.name]: input.binding });
  const nextMcpServers = { ...(agent.mcpServers ?? {}), [input.name]: input.binding };
  const updated = await scope.agentDefinitions.updateMcpServers(input.id, nextMcpServers);
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
    namespace: await actingNamespace(scope, updated.namespace),
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
  const updated = await scope.agentDefinitions.updateMcpServers(input.id, next);
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
    namespace: await actingNamespace(scope, updated.namespace),
  });
  return { mcpServers: updated.mcpServers ?? {} };
}
