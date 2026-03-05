import { describe, it, expect } from 'vitest';
import {
  StepExecutionSchema,
  StepExecutionStatusSchema,
  GateResultSchema,
  ReviewVerdictSchema,
} from '../step-execution.js';

const validStepExecution = {
  id: 'se-001',
  instanceId: 'pi-001',
  stepId: 'collect-data',
  status: 'completed' as const,
  input: { supplierId: 'SUP-001' },
  output: { complianceMetrics: { onTimeRate: 0.95 } },
  verdict: null,
  executedBy: 'agent-supply-collector',
  startedAt: '2026-02-26T10:01:00Z',
  completedAt: '2026-02-26T10:02:00Z',
  iterationNumber: 0,
  gateResult: null,
  error: null,
};

const validGateResult = {
  next: 'review',
  reason: 'All required data fields present',
};

const validReviewVerdict = {
  reviewerId: 'dr-smith',
  reviewerRole: 'supply-reviewer',
  verdict: 'approved',
  comment: 'Supplier metrics within acceptable range',
  timestamp: '2026-02-26T10:30:00Z',
};

describe('StepExecutionStatusSchema', () => {
  it('should accept all valid status values', () => {
    for (const status of ['pending', 'running', 'completed', 'failed']) {
      const result = StepExecutionStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    }
  });

  it('should reject an invalid status value', () => {
    const result = StepExecutionStatusSchema.safeParse('cancelled');
    expect(result.success).toBe(false);
  });
});

describe('GateResultSchema', () => {
  it('should parse a valid gate result', () => {
    const result = GateResultSchema.safeParse(validGateResult);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.next).toBe('review');
      expect(result.data.reason).toBe('All required data fields present');
    }
  });

  it('should reject a gate result with empty next', () => {
    const result = GateResultSchema.safeParse({ ...validGateResult, next: '' });
    expect(result.success).toBe(false);
  });

  it('should accept an empty reason string', () => {
    const result = GateResultSchema.safeParse({ ...validGateResult, reason: '' });
    expect(result.success).toBe(true);
  });

  it('should reject a gate result with missing next', () => {
    const { next: _, ...noNext } = validGateResult;
    const result = GateResultSchema.safeParse(noNext);
    expect(result.success).toBe(false);
  });
});

describe('ReviewVerdictSchema', () => {
  it('should parse a valid review verdict', () => {
    const result = ReviewVerdictSchema.safeParse(validReviewVerdict);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewerId).toBe('dr-smith');
      expect(result.data.verdict).toBe('approved');
      expect(result.data.comment).toBe('Supplier metrics within acceptable range');
    }
  });

  it('should parse a verdict with null comment', () => {
    const result = ReviewVerdictSchema.safeParse({
      ...validReviewVerdict,
      comment: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).toBeNull();
    }
  });

  it('should reject a verdict with empty reviewerId', () => {
    const result = ReviewVerdictSchema.safeParse({
      ...validReviewVerdict,
      reviewerId: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a verdict with empty verdict string', () => {
    const result = ReviewVerdictSchema.safeParse({
      ...validReviewVerdict,
      verdict: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a verdict with invalid timestamp', () => {
    const result = ReviewVerdictSchema.safeParse({
      ...validReviewVerdict,
      timestamp: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('StepExecutionSchema', () => {
  it('should parse a valid completed step execution', () => {
    const result = StepExecutionSchema.safeParse(validStepExecution);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('se-001');
      expect(result.data.instanceId).toBe('pi-001');
      expect(result.data.status).toBe('completed');
      expect(result.data.iterationNumber).toBe(0);
      expect(result.data.verdict).toBeNull();
      expect(result.data.gateResult).toBeNull();
    }
  });

  it('should parse a step execution with gate result', () => {
    const withGate = {
      ...validStepExecution,
      gateResult: validGateResult,
    };
    const result = StepExecutionSchema.safeParse(withGate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gateResult?.next).toBe('review');
    }
  });

  it('should parse a review step execution with verdict and review verdicts', () => {
    const reviewExec = {
      ...validStepExecution,
      stepId: 'supply-review',
      verdict: 'approved',
      iterationNumber: 2,
      reviewVerdicts: [validReviewVerdict],
    };
    const result = StepExecutionSchema.safeParse(reviewExec);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBe('approved');
      expect(result.data.iterationNumber).toBe(2);
      expect(result.data.reviewVerdicts).toHaveLength(1);
      expect(result.data.reviewVerdicts?.[0].reviewerId).toBe('dr-smith');
    }
  });

  it('should parse a step execution without optional reviewVerdicts', () => {
    const result = StepExecutionSchema.safeParse(validStepExecution);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewVerdicts).toBeUndefined();
    }
  });

  it('should parse a failed step execution with error', () => {
    const failed = {
      ...validStepExecution,
      status: 'failed',
      output: null,
      completedAt: null,
      error: 'Timeout after 30 minutes',
    };
    const result = StepExecutionSchema.safeParse(failed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error).toBe('Timeout after 30 minutes');
      expect(result.data.output).toBeNull();
      expect(result.data.completedAt).toBeNull();
    }
  });

  it('should accept iterationNumber of 0', () => {
    const result = StepExecutionSchema.safeParse(validStepExecution);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.iterationNumber).toBe(0);
    }
  });

  it('should reject a negative iterationNumber', () => {
    const result = StepExecutionSchema.safeParse({
      ...validStepExecution,
      iterationNumber: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject a non-integer iterationNumber', () => {
    const result = StepExecutionSchema.safeParse({
      ...validStepExecution,
      iterationNumber: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject a step execution with empty id', () => {
    const result = StepExecutionSchema.safeParse({ ...validStepExecution, id: '' });
    expect(result.success).toBe(false);
  });

  it('should reject a step execution with empty instanceId', () => {
    const result = StepExecutionSchema.safeParse({ ...validStepExecution, instanceId: '' });
    expect(result.success).toBe(false);
  });

  it('should reject a step execution with empty executedBy', () => {
    const result = StepExecutionSchema.safeParse({ ...validStepExecution, executedBy: '' });
    expect(result.success).toBe(false);
  });

  it('should reject a step execution with invalid status', () => {
    const result = StepExecutionSchema.safeParse({ ...validStepExecution, status: 'cancelled' });
    expect(result.success).toBe(false);
  });

  it('should reject a step execution with invalid startedAt', () => {
    const result = StepExecutionSchema.safeParse({
      ...validStepExecution,
      startedAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a step execution with missing required fields', () => {
    const { id: _, ...noId } = validStepExecution;
    const result = StepExecutionSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });
});
