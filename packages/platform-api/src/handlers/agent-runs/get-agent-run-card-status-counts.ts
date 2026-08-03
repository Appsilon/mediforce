import type {
  GetAgentRunCardStatusCountsInput,
  GetAgentRunCardStatusCountsOutput,
} from '../../contract/agent-runs';
import type { CallerScope } from '../../repositories/index';

/**
 * Grouped `AgentRunCardStatus` counts for the Agents tab's KPI cards —
 * computed in Postgres, not by fetching every run and tallying in JS. Same
 * filters as `listAgentRuns` (minus `cardStatus` itself and pagination), so
 * a KPI card's number always matches what clicking it would filter the
 * table to.
 */
export async function getAgentRunCardStatusCounts(
  input: GetAgentRunCardStatusCountsInput,
  scope: CallerScope,
): Promise<GetAgentRunCardStatusCountsOutput> {
  const counts = await scope.agentRuns.countByCardStatus({
    namespace: input.namespace,
    status: input.status,
    processInstanceIds: input.processInstanceIds,
  });
  return { counts };
}
