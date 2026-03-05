import { describe, it, expect } from 'vitest';
import {
  AgentOutputEnvelopeSchema,
  AnnotationSchema,
} from '../agent-output-envelope.js';

const validAnnotation = {
  id: 'ann-1',
  content: 'This field looks suspicious',
  timestamp: '2026-02-26T10:00:00Z',
};

const validEnvelope = {
  confidence: 0.87,
  reasoning_summary: 'Analyzed patient data and found potential anomalies',
  reasoning_chain: ['Step 1: Load data', 'Step 2: Apply rules', 'Step 3: Score'],
  annotations: [validAnnotation],
  model: 'anthropic/claude-sonnet-4',
  duration_ms: 1200,
  result: { flagged: true, score: 0.87 },
};

describe('AnnotationSchema', () => {
  it('should parse a valid annotation', () => {
    const result = AnnotationSchema.safeParse(validAnnotation);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('ann-1');
      expect(result.data.content).toBe('This field looks suspicious');
    }
  });

  it('should reject annotation with invalid timestamp', () => {
    const result = AnnotationSchema.safeParse({
      ...validAnnotation,
      timestamp: 'not-a-datetime',
    });
    expect(result.success).toBe(false);
  });

  it('should reject annotation missing required fields', () => {
    const result = AnnotationSchema.safeParse({ id: 'ann-1' });
    expect(result.success).toBe(false);
  });
});

describe('AgentOutputEnvelopeSchema', () => {
  it('should parse a valid envelope with all fields', () => {
    const result = AgentOutputEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence).toBe(0.87);
      expect(result.data.model).toBe('anthropic/claude-sonnet-4');
      expect(result.data.duration_ms).toBe(1200);
    }
  });

  it('should accept confidence: 0 (minimum boundary)', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      confidence: 0,
    });
    expect(result.success).toBe(true);
  });

  it('should accept confidence: 1 (maximum boundary)', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  it('should reject confidence below 0', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      confidence: -0.01,
    });
    expect(result.success).toBe(false);
  });

  it('should reject confidence above 1', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      confidence: 1.01,
    });
    expect(result.success).toBe(false);
  });

  it('should accept model: null (for non-LLM agents)', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      model: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBeNull();
    }
  });

  it('should accept result: null (for L0/L2 annotations-only agents)', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      result: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.result).toBeNull();
    }
  });

  it('should accept duration_ms: 0', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      duration_ms: 0,
    });
    expect(result.success).toBe(true);
  });

  it('should reject negative duration_ms', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      duration_ms: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer duration_ms', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      duration_ms: 1200.5,
    });
    expect(result.success).toBe(false);
  });

  it('should accept empty annotations array', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      annotations: [],
    });
    expect(result.success).toBe(true);
  });

  it('should accept annotations array with valid annotation', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      annotations: [validAnnotation],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.annotations).toHaveLength(1);
    }
  });

  it('should accept empty reasoning_chain array', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      reasoning_chain: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject envelope missing confidence', () => {
    const { confidence: _, ...noConfidence } = validEnvelope;
    const result = AgentOutputEnvelopeSchema.safeParse(noConfidence);
    expect(result.success).toBe(false);
  });
});
