import type { CallerScope } from '../../repositories/index.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetAgentDefinitionInput,
  GetAgentDefinitionOutput,
} from '../../contract/definitions.js';

/**
 * Fetch one agent definition by id. The wrapper handles visibility + workspace
 * gating; out-of-scope rows collapse to 404.
 */
export async function getAgentDefinition(
  input: GetAgentDefinitionInput,
  scope: CallerScope,
): Promise<GetAgentDefinitionOutput> {
  const agent = await scope.agentDefinitions.getById(input.id);
  if (agent === null) {
    throw new NotFoundError(`Agent definition ${input.id} not found`);
  }
  return { agent };
}
