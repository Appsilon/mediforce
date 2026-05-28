import type { UpdateAgentInput, UpdateAgentBody, UpdateAgentOutput } from '../../contract/agents.js';
import type { CallerScope } from '../../repositories/index.js';
import { actorFromCaller } from '../_helpers.js';

// Body is merged into input by the route adapter — see route.ts for the
// inputFromRequest shape. Wrapper enforces namespace-write on the existing
// agent's namespace; missing agent surfaces as NotFoundError from the wrapper.
export async function updateAgent(
  input: UpdateAgentInput & { body: UpdateAgentBody },
  scope: CallerScope,
): Promise<UpdateAgentOutput> {
  const agent = await scope.agentDefinitions.update(input.id, input.body);
  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'agent.updated',
    description: `Agent '${agent.name ?? agent.id}' updated`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { agentId: input.id, patchKeys: Object.keys(input.body) },
    outputSnapshot: { name: agent.name },
    basis: 'Agent updated via API',
    entityType: 'agentDefinition',
    entityId: agent.id,
  });
  return { agent };
}
