import { describe, it, expect } from 'vitest';
import { StepOutputEnvelopeSchema, AgentOutputEnvelopeSchema, AnnotationSchema } from '../agent-output-envelope';

const validAnnotation = {
  id: 'ann-1',
  content: 'This field looks suspicious',
  timestamp: '2026-02-26T10:00:00Z',
};

const validStepEnvelope = {
  duration_ms: 1200,
  result: { status: 'ok', rows_processed: 42 },
  annotations: [],
};

const validEnvelope = {
  ...validStepEnvelope,
  confidence: 0.87,
  reasoning_summary: 'Analyzed patient data and found potential anomalies',
  reasoning_chain: ['Step 1: Load data', 'Step 2: Apply rules', 'Step 3: Score'],
  annotations: [validAnnotation],
  model: 'anthropic/claude-sonnet-4',
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

describe('StepOutputEnvelopeSchema', () => {
  it('should parse a valid step envelope', () => {
    const result = StepOutputEnvelopeSchema.safeParse(validStepEnvelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration_ms).toBe(1200);
      expect(result.data.result).toEqual({ status: 'ok', rows_processed: 42 });
      expect(result.data.annotations).toEqual([]);
    }
  });

  it('should accept result: null', () => {
    const result = StepOutputEnvelopeSchema.safeParse({ ...validStepEnvelope, result: null });
    expect(result.success).toBe(true);
  });

  it('should accept optional fields (gitMetadata, presentation, deliverableFile)', () => {
    const result = StepOutputEnvelopeSchema.safeParse({
      ...validStepEnvelope,
      gitMetadata: { commitSha: 'abc', branch: 'main', changedFiles: [], repoUrl: 'https://x' },
      presentation: { kind: 'markdown', content: '## Done' },
      deliverableFile: '/tmp/report.pdf',
    });
    expect(result.success).toBe(true);
  });

  it('should reject negative duration_ms', () => {
    const result = StepOutputEnvelopeSchema.safeParse({ ...validStepEnvelope, duration_ms: -1 });
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const result = StepOutputEnvelopeSchema.safeParse({ duration_ms: 100 });
    expect(result.success).toBe(false);
  });

  it('should strip agent-only fields from an AgentOutputEnvelope payload', () => {
    const result = StepOutputEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('confidence');
      expect(result.data).not.toHaveProperty('model');
      expect(result.data).not.toHaveProperty('reasoning_summary');
    }
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

  it('should accept envelope without confidence_rationale (optional field)', () => {
    const result = AgentOutputEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
  });

  it('should accept envelope with confidence_rationale', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      confidence_rationale: 'Routine case with complete data. Expected error rate below 5 in 100.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence_rationale).toBe(
        'Routine case with complete data. Expected error rate below 5 in 100.',
      );
    }
  });

  it('should coerce a raw presentation string into {kind: html} for back-compat', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      presentation: '<h1>Report</h1>',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.presentation).toEqual({ kind: 'html', content: '<h1>Report</h1>' });
    }
  });

  it('should accept envelope without presentation (backward compat)', () => {
    const result = AgentOutputEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.presentation).toBeUndefined();
    }
  });

  it('should accept envelope with presentation: null', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      presentation: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.presentation).toBeNull();
    }
  });

  it('should accept envelope with structured markdown presentation', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      presentation: { kind: 'markdown', content: '## Heading\n\n- one\n- two' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.presentation).toEqual({
        kind: 'markdown',
        content: '## Heading\n\n- one\n- two',
      });
    }
  });

  it('should accept envelope with structured html presentation', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      presentation: { kind: 'html', content: '<section>x</section>' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.presentation).toEqual({
        kind: 'html',
        content: '<section>x</section>',
      });
    }
  });

  it('should reject presentation with unknown kind', () => {
    const result = AgentOutputEnvelopeSchema.safeParse({
      ...validEnvelope,
      presentation: { kind: 'rich', content: 'whatever' },
    });
    expect(result.success).toBe(false);
  });
});
