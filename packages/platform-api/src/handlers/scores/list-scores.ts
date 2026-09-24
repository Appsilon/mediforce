import type { ListScoresInput, ListScoresOutput } from '../../contract/scores';
import type { CallerScope } from '../../repositories/index';

const DEFAULT_LIMIT = 100;

/** Scores visible to the caller, newest first; gating lives in `scope.scores`. */
export async function listScores(
  input: ListScoresInput,
  scope: CallerScope,
): Promise<ListScoresOutput> {
  const scores = await scope.scores.list({
    limit: input.limit ?? DEFAULT_LIMIT,
    ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
    ...(input.agentRunId !== undefined ? { agentRunId: input.agentRunId } : {}),
    ...(input.runId !== undefined ? { processInstanceId: input.runId } : {}),
    ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
  });
  return { scores };
}
