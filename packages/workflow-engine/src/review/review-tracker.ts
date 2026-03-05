import type { ReviewVerdict } from '@mediforce/platform-core';

interface StepReviewState {
  iterationNumber: number;
  verdicts: ReviewVerdict[];
}

/**
 * ReviewTracker: verdict array management, iteration counting, limit enforcement.
 * Manages per-step review state with lazy initialization.
 */
export class ReviewTracker {
  private state = new Map<string, StepReviewState>();

  private getOrCreate(stepId: string): StepReviewState {
    let entry = this.state.get(stepId);
    if (!entry) {
      entry = { iterationNumber: 0, verdicts: [] };
      this.state.set(stepId, entry);
    }
    return entry;
  }

  addVerdict(stepId: string, verdict: ReviewVerdict): void {
    const entry = this.getOrCreate(stepId);
    entry.verdicts.push(verdict);
  }

  getVerdicts(stepId: string): ReviewVerdict[] {
    const entry = this.state.get(stepId);
    return entry ? [...entry.verdicts] : [];
  }

  incrementIteration(stepId: string): void {
    const entry = this.getOrCreate(stepId);
    entry.iterationNumber += 1;
  }

  getCurrentIteration(stepId: string): number {
    const entry = this.state.get(stepId);
    return entry ? entry.iterationNumber : 0;
  }

  isMaxIterationsExceeded(stepId: string, maxIterations: number): boolean {
    return this.getCurrentIteration(stepId) >= maxIterations;
  }

  reset(stepId: string): void {
    this.state.delete(stepId);
  }
}
