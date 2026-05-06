import { describe, it, expect } from 'vitest';
import { validatePayload } from '../payload-validator.js';
import type { TriggerInputField } from '../../schemas/workflow-definition.js';

const field = (overrides: Partial<TriggerInputField> & { name: string }): TriggerInputField => ({
  type: 'string',
  required: false,
  ...overrides,
});

describe('validatePayload', () => {
  it('accepts empty payload when no fields required', () => {
    const result = validatePayload({}, [field({ name: 'optional' })]);
    expect(result.valid).toBe(true);
  });

  it('rejects missing required field', () => {
    const result = validatePayload({}, [field({ name: 'ruleId', required: true })]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe('ruleId');
    expect(result.errors[0]!.message).toMatch(/required/);
  });

  it('accepts valid required field', () => {
    const result = validatePayload(
      { ruleId: 'CORE-000127' },
      [field({ name: 'ruleId', required: true })],
    );
    expect(result.valid).toBe(true);
  });

  it('rejects unknown fields (strict)', () => {
    const result = validatePayload(
      { ruleId: 'CORE-000127', extra: 'nope' },
      [field({ name: 'ruleId' })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe('extra');
    expect(result.errors[0]!.message).toMatch(/unknown/);
  });

  it('validates string type', () => {
    const result = validatePayload({ name: 123 }, [field({ name: 'name', type: 'string' })]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/string/);
  });

  it('validates number type', () => {
    const result = validatePayload({ count: 'abc' }, [field({ name: 'count', type: 'number' })]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/number/);
  });

  it('validates boolean type', () => {
    const result = validatePayload({ flag: 'yes' }, [field({ name: 'flag', type: 'boolean' })]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/boolean/);
  });

  it('validates select with options', () => {
    const result = validatePayload(
      { status: 'invalid' },
      [field({ name: 'status', type: 'select', options: ['active', 'inactive'] })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/one of/);
  });

  it('accepts valid select option', () => {
    const result = validatePayload(
      { status: 'active' },
      [field({ name: 'status', type: 'select', options: ['active', 'inactive'] })],
    );
    expect(result.valid).toBe(true);
  });

  it('validates multiselect must be array', () => {
    const result = validatePayload(
      { tags: 'one' },
      [field({ name: 'tags', type: 'multiselect', options: ['one', 'two'] })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/array/);
  });

  it('validates multiselect options', () => {
    const result = validatePayload(
      { tags: ['one', 'bad'] },
      [field({ name: 'tags', type: 'multiselect', options: ['one', 'two'] })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/invalid options/);
  });

  it('reports all invalid multiselect options in one error', () => {
    const result = validatePayload(
      { tags: ['bad1', 'bad2', 'ok'] },
      [field({ name: 'tags', type: 'multiselect', options: ['ok', 'also-ok'] })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toContain('bad1');
    expect(result.errors[0]!.message).toContain('bad2');
  });

  it('rejects required multiselect with empty array', () => {
    const result = validatePayload(
      { tags: [] },
      [field({ name: 'tags', type: 'multiselect', required: true, options: ['a', 'b'] })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/at least one selection/);
  });

  it('accepts optional multiselect with empty array', () => {
    const result = validatePayload(
      { tags: [] },
      [field({ name: 'tags', type: 'multiselect', options: ['a', 'b'] })],
    );
    expect(result.valid).toBe(true);
  });

  it('rejects NaN as number', () => {
    const result = validatePayload(
      { count: NaN },
      [field({ name: 'count', type: 'number' })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/number/);
  });

  it('accepts valid multiselect', () => {
    const result = validatePayload(
      { tags: ['one', 'two'] },
      [field({ name: 'tags', type: 'multiselect', options: ['one', 'two', 'three'] })],
    );
    expect(result.valid).toBe(true);
  });

  it('validates textarea as string', () => {
    const result = validatePayload({ notes: 42 }, [field({ name: 'notes', type: 'textarea' })]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/string/);
  });

  it('rejects invalid date string', () => {
    const result = validatePayload(
      { dob: 'not-a-date' },
      [field({ name: 'dob', type: 'date' })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/not a valid date/);
  });

  it('accepts valid ISO date', () => {
    const result = validatePayload(
      { dob: '2024-01-15' },
      [field({ name: 'dob', type: 'date' })],
    );
    expect(result.valid).toBe(true);
  });

  it('collects multiple errors', () => {
    const result = validatePayload(
      { extra: 'x' },
      [
        field({ name: 'required1', required: true }),
        field({ name: 'required2', required: true }),
      ],
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  describe('API route integration scenario', () => {
    const triggerInput = [
      field({ name: 'ruleId', type: 'string', required: true }),
      field({ name: 'priority', type: 'select', options: ['low', 'medium', 'high'] }),
      field({ name: 'tags', type: 'multiselect', required: true, options: ['safety', 'efficacy'] }),
      field({ name: 'dryRun', type: 'boolean' }),
    ];

    it('accepts valid full payload', () => {
      const result = validatePayload(
        { ruleId: 'CORE-000127', priority: 'high', tags: ['safety'], dryRun: false },
        triggerInput,
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects payload missing required fields', () => {
      const result = validatePayload({}, triggerInput);
      expect(result.valid).toBe(false);
      const fieldNames = result.errors.map((e) => e.field);
      expect(fieldNames).toContain('ruleId');
      expect(fieldNames).toContain('tags');
    });

    it('rejects payload with unknown + wrong type + invalid option', () => {
      const result = validatePayload(
        { ruleId: 123, priority: 'critical', tags: ['safety'], unknown: 'x' },
        triggerInput,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
    });
  });
});
