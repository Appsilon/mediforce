import { describe, it, expect } from 'vitest';
import { StepVariantPatchSchema } from '../evaluation';

describe('StepVariantPatchSchema', () => {
  it('reads a patch stored with few-shot examples, ignoring them (ADR-0024)', () => {
    const stored = { model: 'openai/gpt-5', examples: [{ input: 'Sepsis, fatal', output: '{"grade": 5}' }] };
    expect(StepVariantPatchSchema.parse(stored)).toEqual({ model: 'openai/gpt-5' });
  });
});
