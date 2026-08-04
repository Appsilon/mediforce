import { describe, it, expect } from 'vitest';
import { validatePayload } from '../payload-validator';
import type { TriggerInputField } from '../../schemas/workflow-definition';

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

  it('rejects a non-string datetime', () => {
    const result = validatePayload(
      { startsAt: 1718700000000 },
      [field({ name: 'startsAt', type: 'datetime' })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/datetime string/);
  });

  it('rejects an unparseable datetime string', () => {
    const result = validatePayload(
      { startsAt: 'tomorrow-ish' },
      [field({ name: 'startsAt', type: 'datetime' })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toMatch(/not a valid datetime/);
  });

  it('accepts a valid ISO datetime', () => {
    const result = validatePayload(
      { startsAt: '2026-06-18T09:15:00.000Z' },
      [field({ name: 'startsAt', type: 'datetime' })],
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

  // ADR-0012: `object` is how an un-enumerable body (a proxied third-party JSON
  // blob) enters a Run without a second, unvalidated input channel.
  describe('object fields', () => {
    const opaque = [field({ name: 'entry', type: 'object', required: true })];

    it('accepts an arbitrary nested JSON object', () => {
      const result = validatePayload(
        { entry: { meal: 'lunch', items: [{ kcal: 500 }], nested: { deep: true } } },
        opaque,
      );
      expect(result.valid).toBe(true);
    });

    it('accepts an empty object', () => {
      expect(validatePayload({ entry: {} }, opaque).valid).toBe(true);
    });

    it('rejects an array — it has no keys to walk', () => {
      const result = validatePayload({ entry: [1, 2] }, opaque);
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.message).toMatch(/JSON object/);
    });

    it('rejects a scalar', () => {
      expect(validatePayload({ entry: 'text' }, opaque).valid).toBe(false);
      expect(validatePayload({ entry: 7 }, opaque).valid).toBe(false);
    });

    it('treats null as absent, so a required object field is reported missing', () => {
      const result = validatePayload({ entry: null }, opaque);
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.message).toMatch(/required/);
    });
  });

  // A `default` belongs to the contract, not to the manual form that used to be
  // the only thing reading it — a webhook, cron row or spawn that omits the
  // field must land on the same value the Start Run form would have prefilled.
  describe('defaults', () => {
    it('fills an absent field from its default', () => {
      const result = validatePayload({}, [field({ name: 'region', default: 'eu' })]);
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual({ region: 'eu' });
    });

    it('satisfies a required field that has a default', () => {
      const result = validatePayload({}, [
        field({ name: 'region', required: true, default: 'eu' }),
      ]);
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual({ region: 'eu' });
    });

    it('lets a supplied value win over the default', () => {
      const result = validatePayload({ region: 'us' }, [field({ name: 'region', default: 'eu' })]);
      expect(result.payload).toEqual({ region: 'us' });
    });

    it('keeps a supplied falsy value instead of the default', () => {
      const result = validatePayload(
        { dryRun: false, retries: 0 },
        [
          field({ name: 'dryRun', type: 'boolean', default: true }),
          field({ name: 'retries', type: 'number', default: 3 }),
        ],
      );
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual({ dryRun: false, retries: 0 });
    });

    it('treats an explicit null as absent and applies the default', () => {
      const result = validatePayload({ region: null }, [field({ name: 'region', default: 'eu' })]);
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual({ region: 'eu' });
    });

    it('validates the default like any other value, so a mistyped one is caught', () => {
      const result = validatePayload({}, [field({ name: 'count', type: 'number', default: 'ten' })]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.field).toBe('count');
      expect(result.errors[0]!.message).toMatch(/number/);
    });

    it('leaves a defaultless absent field out of the payload', () => {
      const result = validatePayload({ region: 'eu' }, [
        field({ name: 'region' }),
        field({ name: 'note' }),
      ]);
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual({ region: 'eu' });
    });

    it('returns the payload unchanged when no field declares a default', () => {
      const payload = { region: 'eu', tags: ['safety'] };
      const result = validatePayload(payload, [
        field({ name: 'region' }),
        field({ name: 'tags', type: 'multiselect', options: ['safety'] }),
      ]);
      expect(result.payload).toEqual(payload);
    });
  });

  // The contract is *total*: an empty triggerInput means "this workflow takes no
  // input", not "anything goes". Every trigger relies on this to reject a
  // firing that carries fields the workflow never declared.
  describe('empty contract', () => {
    it('accepts an empty payload', () => {
      expect(validatePayload({}, []).valid).toBe(true);
    });

    it('rejects any field at all', () => {
      const result = validatePayload({ anything: 1 }, []);
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.field).toBe('anything');
    });
  });
});
