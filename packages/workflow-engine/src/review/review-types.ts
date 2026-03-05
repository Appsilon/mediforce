import type { ReviewVerdict } from '@mediforce/platform-core';

export interface ReviewState {
  stepId: string;
  iterationNumber: number;
  verdicts: ReviewVerdict[];
  maxIterations: number;
}
