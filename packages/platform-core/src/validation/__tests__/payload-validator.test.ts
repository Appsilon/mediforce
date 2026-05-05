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
    expect(result.errors[0]!.message).toMatch(/invalid option/);
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
});
