import type { CreateAgentInput, CreateAgentOutput } from '../../contract/agents';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller } from '../_helpers';

export async function createAgent(input: CreateAgentInput, scope: CallerScope): Promise<CreateAgentOutput> {
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
