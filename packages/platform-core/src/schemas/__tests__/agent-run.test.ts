import { describe, it, expect } from 'vitest';
import {
  AgentRunSchema,
  AgentRunStatusSchema,
} from '../agent-run.js';

const validEnvelope = {
  confidence: 0.87,
  reasoning_summary: 'Analysis complete',
  reasoning_chain: ['Step 1', 'Step 2'],
  annotations: [],
  model: 'anthropic/claude-sonnet-4',
  duration_ms: 1200,
  result: { flagged: true },
};

const validRun = {
  id: 'run-123',
  processInstanceId: 'inst-456',
  stepId: 'analyze-step',
  pluginId: '@mediforce/example-agent',
  autonomyLevel: 'L2' as const,
  status: 'completed' as const,
  envelope: validEnvelope,
  fallbackReason: null,
  startedAt: '2026-02-26T10:00:00Z',
  completedAt: '2026-02-26T10:00:01.200Z',
};

describe('AgentRunStatusSchema', () => {
  const validStatuses = [
    'running',
    'completed',
    'timed_out',
    'low_confidence',
    'error',
    'escalated',
    'flagged',
    'paused',
  ] as const;

  for (const status of validStatuses) {
    it(`should accept status: '${status}'`, () => {
      const result = AgentRunStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    });
  }

  it('should reject invalid status', () => {
    const result = AgentRunStatusSchema.safeParse('cancelled');
    expect(result.success).toBe(false);
  });
});

describe('AgentRunSchema', () => {
  it('should parse a valid completed run', () => {
    const result = AgentRunSchema.safeParse(validRun);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('run-123');
      expect(result.data.status).toBe('completed');
      expect(result.data.autonomyLevel).toBe('L2');
    }
  });

  const validAutonomyLevels = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
  for (const level of validAutonomyLevels) {
    it(`should accept autonomyLevel: '${level}'`, () => {
      const result = AgentRunSchema.safeParse({
        ...validRun,
        autonomyLevel: level,
      });
      expect(result.success).toBe(true);
    });
  }

  it('should accept envelope: null (before agent completes)', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      status: 'running',
      envelope: null,
      completedAt: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.envelope).toBeNull();
    }
  });

  it('should accept completedAt: null (running state)', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      status: 'running',
      envelope: null,
      completedAt: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.completedAt).toBeNull();
    }
  });

  it('should accept fallbackReason: null', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      fallbackReason: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fallbackReason).toBeNull();
    }
  });

  it('should accept fallbackReason as a string', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      status: 'escalated',
      fallbackReason: 'Confidence below threshold',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fallbackReason).toBe('Confidence below threshold');
    }
  });

  it('should reject invalid status', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      status: 'cancelled',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid autonomy level', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      autonomyLevel: 'L5',
    });
    expect(result.success).toBe(false);
  });

  it('should reject run missing required fields', () => {
    const result = AgentRunSchema.safeParse({ id: 'run-123' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should accept executorType "agent" and reviewerType "human"', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      executorType: 'agent',
      reviewerType: 'human',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executorType).toBe('agent');
      expect(result.data.reviewerType).toBe('human');
    }
  });

  it('[DATA] should accept reviewerType "none" (L4 autonomous)', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      executorType: 'agent',
      reviewerType: 'none',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewerType).toBe('none');
    }
  });

  it('[DATA] should accept reviewerType "agent"', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      executorType: 'agent',
      reviewerType: 'agent',
    });
    expect(result.success).toBe(true);
  });

  it('[DATA] should parse without executorType/reviewerType (backward compat)', () => {
    const result = AgentRunSchema.safeParse(validRun);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executorType).toBeUndefined();
      expect(result.data.reviewerType).toBeUndefined();
    }
  });

  it('[DATA] should reject invalid executorType', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      executorType: 'bot',
    });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject invalid reviewerType', () => {
    const result = AgentRunSchema.safeParse({
      ...validRun,
      reviewerType: 'bot',
    });
    expect(result.success).toBe(false);
  });
});
