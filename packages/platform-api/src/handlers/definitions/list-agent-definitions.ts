import type { CallerScope } from '../../repositories/index.js';
import type {
  ListAgentDefinitionsInput,
  ListAgentDefinitionsOutput,
} from '../../contract/definitions.js';

/** List agent definitions visible to the caller. Wrapper enforces visibility. */
export async function listAgentDefinitions(
  _input: ListAgentDefinitionsInput,
  scope: CallerScope,
): Promise<ListAgentDefinitionsOutput> {
  const agents = await scope.agentDefinitions.list();
  return { agents };
}
