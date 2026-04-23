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
 * Input shape is the existing `CreateAgentDefinitionInputSchema` from
 * platform-core — the contract re-exports it under
 * `CreateAgentDefinitionInputContractSchema`.
 */
export async function createAgentDefinition(
  input: CreateAgentDefinitionInput,
  deps: CreateAgentDefinitionDeps,
): Promise<CreateAgentDefinitionOutput> {
  const agent = await deps.agentDefinitionRepo.create(input);
  return { agent };
}
