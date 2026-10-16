import type { UpdateAgentInput, UpdateAgentBody, UpdateAgentOutput } from '../../contract/agents';
import { mergeAgentUpdate, type AgentDefinition } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { ConflictError } from '../../errors';
import { actorFromCaller } from '../_helpers';
import { assertAgentMayHoldSkills } from '../skills/may-hold-skills';
import { assertBindingsTargetCatalogEntries } from './mcp-bindings';
import { recordAgentVersion } from './_lib/agent-version';

// Body is merged into input by the route adapter — see route.ts for the
// inputFromRequest shape. Wrapper enforces namespace-write on the existing
// agent's namespace; missing agent surfaces as NotFoundError from the wrapper.
export async function updateAgent(
  input: UpdateAgentInput & { body: UpdateAgentBody },
  scope: CallerScope,
): Promise<UpdateAgentOutput> {
  // A patch to skills, visibility or namespace can each break the rule on
  // which Skills the agent may hold. Moving the agent to another workspace
  // re-points every binding at that workspace's catalog, so a namespace or
  // mcpServers change re-checks them all. Both checks run on the merged result.
  const touchesSkills = input.body.skills !== undefined || input.body.visibility !== undefined || input.body.namespace !== undefined;
  const touchesBindings = input.body.mcpServers !== undefined || input.body.namespace !== undefined;
  if (touchesSkills || touchesBindings) {
    const existing = await scope.agentDefinitions.getForUpdate(input.id);
    if (input.body.namespace !== undefined) await assertMayLeaveWorkspace(scope, existing, input.body.namespace);
    const merged = mergeAgentUpdate(existing, input.body);
    if (touchesSkills) await assertAgentMayHoldSkills(merged, scope);
    if (touchesBindings) await assertBindingsTargetCatalogEntries(scope, merged.namespace, merged.mcpServers);
  }
  const agent = await scope.agentDefinitions.update(input.id, input.body);
  await recordAgentVersion(scope, agent);
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

/**
 * An Agent that owns Evaluation rows cannot move to another workspace
 * (ADR-0029): they live in its workspace, so the move would leave its suite
 * behind. Datasets, Qualifications and MCP recordings need a case or an Eval
 * Run, so these lists cover every row.
 */
async function assertMayLeaveWorkspace(scope: CallerScope, agent: AgentDefinition, namespace: string): Promise<void> {
  if (agent.namespace === undefined || agent.namespace === namespace) return;
  const subject = { kind: 'agent', namespace: agent.namespace, agentId: agent.id } as const;
  const { evaluation } = scope;
  const owned = await Promise.all([
    evaluation.listBriefs(subject),
    evaluation.listEvaluators(subject),
    evaluation.listCases(subject),
    evaluation.listAcceptanceCriteria(subject),
    evaluation.listEvalRuns(subject),
  ]);
  if (owned.some((rows) => rows.length > 0) || (await evaluation.getMcpPolicy(subject)) !== null) {
    throw new ConflictError(`Agent '${agent.name}' owns an Evaluation in '${agent.namespace}'; it cannot move to another workspace`);
  }
}
