import type { ListAgentVersionsInput, ListAgentVersionsOutput } from '../../contract/agents';
import type { CallerScope } from '../../repositories/index';
import { loadOr404 } from '../_helpers';
import { currentAgentVersion } from './_lib/agent-version';

/** Every version the Agent was saved or evaluated with (ADR-0029), and the one it has now. */
export async function listAgentVersions(input: ListAgentVersionsInput, scope: CallerScope): Promise<ListAgentVersionsOutput> {
  const agent = await loadOr404(scope.agentDefinitions.getById(input.id), 'Agent not found');
  const [versions, current] = await Promise.all([
    scope.agentDefinitions.listVersions(agent.id),
    currentAgentVersion(scope, agent),
  ]);
  return { versions, current: current?.version ?? null };
}
