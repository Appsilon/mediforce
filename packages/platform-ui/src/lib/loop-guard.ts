export const MAX_SAME_STEP_ITERATIONS = 3;

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
