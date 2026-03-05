export interface GateInput {
  stepId: string;
  stepOutput: Record<string, unknown>;
  processVariables: Record<string, unknown>;
  reviewVerdicts?: Array<{
    reviewerId: string;
    reviewerRole: string;
    verdict: string;
    comment: string | null;
    timestamp: string;
  }>;
}

export type GateFunction = (input: GateInput) => { next: string; reason: string };
