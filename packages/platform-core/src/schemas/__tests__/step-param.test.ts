import { describe, it, expect } from 'vitest';
import { StepParamSchema } from '../process-definition.js';

describe('StepParamSchema.type', () => {
  it.each(['string', 'number', 'boolean', 'date'])('accepts canonical data type %s', (type) => {
    const parsed = StepParamSchema.parse({ name: 'p', type });
    expect(parsed.type).toBe(type);
  });

  it.each(['textarea', 'multiselect'])('accepts widget hint %s', (type) => {
    const parsed = StepParamSchema.parse({ name: 'p', type });
    expect(parsed.type).toBe(type);
  });

  it('defaults to "string" when type is missing', () => {
    const parsed = StepParamSchema.parse({ name: 'p' });
    expect(parsed.type).toBe('string');
  });

  it('rejects empty string (min(1))', () => {
    expect(() => StepParamSchema.parse({ name: 'p', type: '' })).toThrow();
  });

  it('passes through unknown future hint instead of throwing', () => {
    const parsed = StepParamSchema.parse({ name: 'p', type: 'slider' });
    expect(parsed.type).toBe('slider');
  });

  it('rejects non-string type — corruption surfaces loudly', () => {
    expect(() => StepParamSchema.parse({ name: 'p', type: 42 })).toThrow();
    expect(() => StepParamSchema.parse({ name: 'p', type: null })).toThrow();
  });
});
