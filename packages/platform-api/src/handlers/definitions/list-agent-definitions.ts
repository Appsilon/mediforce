import type { AgentDefinitionRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import type {
  ListAgentDefinitionsInput,
  ListAgentDefinitionsOutput,
} from '../../contract/definitions.js';

export interface ListAgentDefinitionsDeps {
  agentDefinitionRepo: AgentDefinitionRepository;
}

/**
 * List agent definitions visible to the caller.
 *
 * Visibility rules:
 *   - api-key callers see every agent.
 *   - user callers see public agents plus private agents owned by a
 *     namespace they're a member of. Agents without a namespace are only
 *     visible if they're public.
 */
export async function listAgentDefinitions(
  _input: ListAgentDefinitionsInput,
  deps: ListAgentDefinitionsDeps,
  caller: CallerIdentity,
): Promise<ListAgentDefinitionsOutput> {
  const agents = await deps.agentDefinitionRepo.list();
  if (caller.kind === 'apiKey') {
    return { agents };
  }
  const visible = agents.filter((agent) => {
    if (agent.visibility === 'public') return true;
    return typeof agent.namespace === 'string' && caller.namespaces.has(agent.namespace);
  });
  return { agents: visible };
}
