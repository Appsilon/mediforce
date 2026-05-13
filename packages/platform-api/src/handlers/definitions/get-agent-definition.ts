import type { AgentDefinitionRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetAgentDefinitionInput,
  GetAgentDefinitionOutput,
} from '../../contract/definitions.js';

export interface GetAgentDefinitionDeps {
  agentDefinitionRepo: AgentDefinitionRepository;
}

/**
 * Fetch one agent definition by id. Public agents are readable by any
 * authenticated caller; private agents only by callers in the agent's
 * namespace. Visibility-denied responses use 404 (not 403) on purpose —
 * acknowledging existence of a private resource leaks information about the
 * namespace, so the route returns the same "not found" shape as a truly
 * missing id. Matches the pre-migration behaviour from
 * `app/api/agent-definitions/[id]/route.ts::canRead`.
 */
export async function getAgentDefinition(
  input: GetAgentDefinitionInput,
  deps: GetAgentDefinitionDeps,
  caller: CallerIdentity,
): Promise<GetAgentDefinitionOutput> {
  const agent = await deps.agentDefinitionRepo.getById(input.id);
  if (agent === null) {
    throw new NotFoundError(`Agent definition ${input.id} not found`);
  }

  if (caller.kind === 'apiKey') return { agent };
  if (agent.visibility === 'public') return { agent };
  if (typeof agent.namespace === 'string' && caller.namespaces.has(agent.namespace)) {
    return { agent };
  }
  throw new NotFoundError(`Agent definition ${input.id} not found`);
}
