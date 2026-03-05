import { describe, it, expect } from 'vitest';
import { StepInputSchema, StepOutputSchema } from '../step-contract.js';

const validStepInput = {
  stepId: 'collect-data',
  processInstanceId: 'pi-123',
  data: { patientId: 'P-001', labResults: [{ test: 'WBC', value: 5.5 }] },
  context: { previousStepId: 'triage', userId: 'user-456' },
};

const validStepOutput = {
  stepId: 'collect-data',
  processInstanceId: 'pi-123',
  result: { status: 'complete', collectedFields: 12 },
  verdict: 'approve',
  metadata: { duration: 1500, source: 'automated' },
};

describe('StepInputSchema', () => {
  it('should parse a valid step input with data and context', () => {
    const result = StepInputSchema.safeParse(validStepInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stepId).toBe('collect-data');
      expect(result.data.processInstanceId).toBe('pi-123');
      expect(result.data.data.patientId).toBe('P-001');
      expect(result.data.context?.previousStepId).toBe('triage');
    }
  });

  it('should parse a step input without optional context', () => {
    const { context: _, ...noContext } = validStepInput;
    const result = StepInputSchema.safeParse(noContext);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context).toBeUndefined();
    }
  });

  it('should parse a step input with empty data', () => {
    const result = StepInputSchema.safeParse({
      stepId: 'step-1',
      processInstanceId: 'pi-1',
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it('should reject a step input with missing stepId', () => {
    const { stepId: _, ...noStepId } = validStepInput;
    const result = StepInputSchema.safeParse(noStepId);
    expect(result.success).toBe(false);
  });

  it('should reject a step input with missing processInstanceId', () => {
    const { processInstanceId: _, ...noProcId } = validStepInput;
    const result = StepInputSchema.safeParse(noProcId);
    expect(result.success).toBe(false);
  });

  it('should reject a step input with missing data', () => {
    const { data: _, ...noData } = validStepInput;
    const result = StepInputSchema.safeParse(noData);
    expect(result.success).toBe(false);
  });
});

describe('StepOutputSchema', () => {
  it('should parse a valid step output with result and verdict', () => {
    const result = StepOutputSchema.safeParse(validStepOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stepId).toBe('collect-data');
      expect(result.data.result.status).toBe('complete');
      expect(result.data.verdict).toBe('approve');
      expect(result.data.metadata?.duration).toBe(1500);
    }
  });

  it('should parse a step output without optional verdict', () => {
    const { verdict: _, ...noVerdict } = validStepOutput;
    const result = StepOutputSchema.safeParse(noVerdict);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBeUndefined();
    }
  });

  it('should parse a step output without optional metadata', () => {
    const { metadata: _, ...noMeta } = validStepOutput;
    const result = StepOutputSchema.safeParse(noMeta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toBeUndefined();
    }
  });

  it('should reject a step output with missing stepId', () => {
    const { stepId: _, ...noStepId } = validStepOutput;
    const result = StepOutputSchema.safeParse(noStepId);
    expect(result.success).toBe(false);
  });

  it('should reject a step output with missing processInstanceId', () => {
    const { processInstanceId: _, ...noProcId } = validStepOutput;
    const result = StepOutputSchema.safeParse(noProcId);
    expect(result.success).toBe(false);
  });

  it('should reject a step output with missing result', () => {
    const { result: _, ...noResult } = validStepOutput;
    const result = StepOutputSchema.safeParse(noResult);
    expect(result.success).toBe(false);
  });
});
