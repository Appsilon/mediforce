import type { CreateAgentInput, CreateAgentOutput } from '../../contract/agents';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { actorFromCaller } from '../_helpers';

export async function createAgent(
  input: CreateAgentInput,
  scope: CallerScope,
): Promise<CreateAgentOutput> {
  // Agents created through the API are always workspace-owned: the audit entry
  // below needs a workspace, and a namespace-less private agent is visible to
  // nobody and mutable by nobody. Built-in platform-global agents are seeded
  // through the repository's `upsert`, never here.
  if (input.namespace === undefined) {
    throw new ValidationError('An agent needs a namespace (the owning workspace).');
  }
  const agent = await scope.agentDefinitions.create(input);
  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'agent.created',
    description: `Agent '${agent.name ?? agent.id}' created${input.namespace !== undefined ? ` in '${input.namespace}'` : ''}`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace ?? null, name: agent.name },
    outputSnapshot: { agentId: agent.id },
    basis: 'Agent created via API',
    entityType: 'agentDefinition',
    entityId: agent.id,
    ...(agent.namespace !== undefined ? { namespace: agent.namespace } : {}),
  });
  return { agent };
}
