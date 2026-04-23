import type { AgentDefinitionRepository } from '@mediforce/platform-core';
import type {
  GetAgentDefinitionInput,
  GetAgentDefinitionOutput,
} from '../../contract/definitions.js';
import { NotFoundError } from '../../errors.js';

export interface GetAgentDefinitionDeps {
  agentDefinitionRepo: AgentDefinitionRepository;
}

export async function getAgentDefinition(
  input: GetAgentDefinitionInput,
  deps: GetAgentDefinitionDeps,
): Promise<GetAgentDefinitionOutput> {
  const agent = await deps.agentDefinitionRepo.getById(input.id);
  if (agent === null) {
    throw new NotFoundError(`Agent definition ${input.id} not found`);
  }
  return { agent };
}
