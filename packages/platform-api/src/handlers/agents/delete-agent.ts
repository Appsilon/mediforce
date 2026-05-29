import type { DeleteAgentInput, DeleteAgentOutput } from '../../contract/agents.js';
import type { CallerScope } from '../../repositories/index.js';
import { actorFromCaller, loadOr404 } from '../_helpers.js';

export async function deleteAgent(
  input: DeleteAgentInput,
  scope: CallerScope,
): Promise<DeleteAgentOutput> {
  // Load first so the audit snapshot can reference the pre-delete shape;
  // wrapper's `delete` will also enforce the namespace-write gate.
  const existing = await loadOr404(scope.agentDefinitions.getById(input.id), 'Agent not found');
  await scope.agentDefinitions.delete(input.id);
  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'agent.deleted',
    description: `Agent '${existing.name ?? input.id}' deleted`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { agentId: input.id, namespace: existing.namespace ?? null },
    outputSnapshot: {},
    basis: 'Agent deleted via API',
    entityType: 'agentDefinition',
    entityId: input.id,
    ...(existing.namespace !== undefined ? { namespace: existing.namespace } : {}),
  });
  return { success: true };
}
