export const MAX_SAME_STEP_ITERATIONS = 3;

/** Floor for the persisted per-step attempt cap (ADR-0010). */
export const MAX_STEP_ATTEMPTS = 10;

/**
 * Persisted, cross-re-kick cap on how many times a single step may be attempted
 * within one run. Unlike {@link isStuckLoop} (per-`/run`, in-memory, resets on
 * every heartbeat re-kick), this counts persisted StepExecution rows, so it
 * bounds a step that is re-kicked and re-run across process deaths (e.g. a hung
 * action with no timeout, a heartbeat-rekicked step) — the termination
 * guarantee of ADR-0010.
 *
 * The ceiling floats above a review step's configured `maxIterations` so a
 * legitimate revise loop is never mistaken for a runaway.
 */
/**
 * Effective attempt cap for a step: the floor plus the step's own review
 * `maxIterations` headroom. Single source so the predicate below and any
 * user-facing "exceeded N attempts" message can't drift apart.
 */
export function resolveStepAttemptCap(maxReviewIterations?: number): number {
  return MAX_STEP_ATTEMPTS + (maxReviewIterations ?? 0);
}

export function hasExceededStepAttempts(
  priorAttempts: number,
  maxReviewIterations?: number,
): boolean {
  return priorAttempts >= resolveStepAttemptCap(maxReviewIterations);
}

export interface LoopTracker {
  previousStepId: string | null;
  count: number;
}

/** Tracks consecutive re-executions of the same step. Returns true if stuck. */
export function isStuckLoop(
  currentStepId: string | null,
  tracker: LoopTracker,
): boolean {
  if (currentStepId === tracker.previousStepId) {
    tracker.count++;
    return tracker.count >= MAX_SAME_STEP_ITERATIONS;
  }
  tracker.count = 0;
  tracker.previousStepId = currentStepId;
  return false;
}

export function createLoopTracker(): LoopTracker {
  return { previousStepId: null, count: 0 };
}
