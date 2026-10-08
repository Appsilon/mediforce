import type { UpdateAgentInput, UpdateAgentBody, UpdateAgentOutput } from '../../contract/agents';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller } from '../_helpers';
import { assertAgentMayHoldSkills } from './agent-skills';
import { assertBindingsTargetCatalogEntries } from './mcp-bindings';

// Body is merged into input by the route adapter — see route.ts for the
// inputFromRequest shape. Wrapper enforces namespace-write on the existing
// agent's namespace; missing agent surfaces as NotFoundError from the wrapper.
export async function updateAgent(
  input: UpdateAgentInput & { body: UpdateAgentBody },
  scope: CallerScope,
): Promise<UpdateAgentOutput> {
  // A patch to skills, visibility or namespace can each break the rule on
  // which Skills the agent may hold, so the merged result is checked.
  if (input.body.skills !== undefined || input.body.visibility !== undefined || input.body.namespace !== undefined) {
    const existing = await scope.agentDefinitions.getForUpdate(input.id);
    await assertAgentMayHoldSkills({ ...existing, ...input.body }, scope);
  }
  // Moving the agent to another workspace re-points every binding at that
  // workspace's catalog, so either change re-checks them all.
  if (input.body.mcpServers !== undefined || input.body.namespace !== undefined) {
    const existing = await scope.agentDefinitions.getForUpdate(input.id);
    const merged = { ...existing, ...input.body };
    await assertBindingsTargetCatalogEntries(scope, merged.namespace, merged.mcpServers);
  }
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
    ...(agent.namespace !== undefined ? { namespace: agent.namespace } : {}),
  });
  return { agent };
}
