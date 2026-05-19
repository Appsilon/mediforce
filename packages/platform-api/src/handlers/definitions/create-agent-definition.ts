import type {
  AgentDefinitionRepository,
  CreateAgentDefinitionInput,
} from '@mediforce/platform-core';
import type { CreateAgentDefinitionOutput } from '../../contract/definitions.js';

export interface CreateAgentDefinitionDeps {
  agentDefinitionRepo: AgentDefinitionRepository;
}

/**
 * Pure handler for `POST /api/agent-definitions`.
 * Input shape is `CreateAgentDefinitionInputSchema` from platform-core
 * (re-exported via `@mediforce/platform-api/contract`).
 */
export async function createAgentDefinition(
  input: CreateAgentDefinitionInput,
  deps: CreateAgentDefinitionDeps,
): Promise<CreateAgentDefinitionOutput> {
  const agent = await deps.agentDefinitionRepo.create(input);
  return { agent };
}
