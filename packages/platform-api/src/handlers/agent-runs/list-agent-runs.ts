import type { CallerScope } from '../../repositories/index.js';
import type {
  ListAgentRunsInput,
  ListAgentRunsOutput,
} from '../../contract/agent-runs.js';

/**
 * List agent runs visible to the caller. Workspace gating is enforced inside
 * `scope.agentRuns.list` (system actors see everything, user callers see only
 * runs whose parent process instance lives in one of their workspaces).
 *
 * Cursor pagination is opaque to the client — the repository encodes the
 * `(startedAt, id)` tie-breaker. Sorting is `startedAt DESC` so the operator
 * sees newest activity first.
 */
export async function listAgentRuns(
  input: ListAgentRunsInput,
  scope: CallerScope,
): Promise<ListAgentRunsOutput> {
  const page = await scope.agentRuns.list({
    limit: input.limit,
    cursor: input.cursor,
    runId: input.runId,
    stepId: input.stepId,
    namespace: input.namespace,
  });
  return {
    runs: [...page.items],
    ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
  };
}
