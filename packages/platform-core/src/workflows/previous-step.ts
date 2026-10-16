import type { Transition } from '../schemas/process-definition';
import type { StepExecution } from '../schemas/step-execution';

/**
 * The step the current step continues from: the one that completed last in
 * this run. A step with several ways in (a revise loop, a merge) has no single
 * predecessor in the definition, so the transitions are only the fallback for
 * a run with no completed step on record.
 */
export function resolvePreviousStepId(
  executions: ReadonlyArray<Pick<StepExecution, 'stepId' | 'status' | 'completedAt'>>,
  transitions: ReadonlyArray<Pick<Transition, 'from' | 'to'>>,
  currentStepId: string,
): string | null {
  let latest: { stepId: string; completedAt: string } | null = null;
  for (const { stepId, status, completedAt } of executions) {
    if (status !== 'completed' || completedAt === null) continue;
    // `>=`: executions come in recording order, so on a tie the later one wins.
    if (latest === null || completedAt >= latest.completedAt) latest = { stepId, completedAt };
  }
  if (latest !== null) return latest.stepId;
  return transitions.find((transition) => transition.to === currentStepId)?.from ?? null;
}
