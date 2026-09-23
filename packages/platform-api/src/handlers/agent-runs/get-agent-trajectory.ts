import type {
  GetAgentTrajectoryInput,
  GetAgentTrajectoryOutput,
} from '../../contract/agent-runs';
import type { CallerScope } from '../../repositories/index';
import { loadOr404 } from '../_helpers';

/**
 * One Agent Run's Agent Trajectory (ADR-0023 D8), or its entries after the
 * `afterSeq` cursor. A run outside the caller's workspaces answers exactly
 * like a run that does not exist.
 */
export async function getAgentTrajectory(
  input: GetAgentTrajectoryInput,
  scope: CallerScope,
): Promise<GetAgentTrajectoryOutput> {
  const entries = await loadOr404(
    scope.agentTrajectories.list(input.agentRunId, { afterSeq: input.afterSeq }),
    `Agent run '${input.agentRunId}' not found`,
  );
  return { agentRunId: input.agentRunId, entries };
}
