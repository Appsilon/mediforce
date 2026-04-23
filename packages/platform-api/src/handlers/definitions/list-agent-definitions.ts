import type { AgentDefinitionRepository } from '@mediforce/platform-core';
import type {
  ListAgentDefinitionsInput,
  ListAgentDefinitionsOutput,
} from '../../contract/definitions.js';

export interface ListAgentDefinitionsDeps {
  agentDefinitionRepo: AgentDefinitionRepository;
}

export async function listAgentDefinitions(
  _input: ListAgentDefinitionsInput,
  deps: ListAgentDefinitionsDeps,
): Promise<ListAgentDefinitionsOutput> {
  const agents = await deps.agentDefinitionRepo.list();
  return { agents };
}
