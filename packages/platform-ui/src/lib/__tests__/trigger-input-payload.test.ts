import { describe, it, expect } from 'vitest';
import type { TriggerInputField } from '@mediforce/platform-core';
import { buildTriggerPayload, hasInvalidObjectInput } from '../trigger-input-payload';

function field(partial: Partial<TriggerInputField> & { name: string }): TriggerInputField {
  return { type: 'string', ...partial } as TriggerInputField;
}

describe('buildTriggerPayload', () => {
  it('sends an object-typed field as a parsed object, never as the raw string', () => {
    const payload = buildTriggerPayload(
      [field({ name: 'body', type: 'object' })],
      { body: '{"patient": {"id": "P-1"}}' },
    );

    expect(payload).toEqual({ body: { patient: { id: 'P-1' } } });
  });

  it('passes an object-typed field through when the held value is already an object', () => {
    const payload = buildTriggerPayload(
      [field({ name: 'body', type: 'object' })],
      { body: { patient: { id: 'P-1' } } },
    );

    expect(payload).toEqual({ body: { patient: { id: 'P-1' } } });
  });

  it('omits an object-typed field whose text does not parse as a JSON object', () => {
    const payload = buildTriggerPayload(
      [field({ name: 'body', type: 'object' })],
      { body: '{"a": ' },
    );

    expect(payload).toEqual({});
  });

  it('keeps the existing coercions for other field types', () => {
    const payload = buildTriggerPayload(
      [
        field({ name: 'title' }),
        field({ name: 'count', type: 'number' }),
        field({ name: 'enabled', type: 'boolean' }),
        field({ name: 'sites', type: 'multiselect' }),
        field({ name: 'skipped' }),
        field({ name: 'noSelection', type: 'multiselect' }),
      ],
      {
        title: 'Study A',
        count: '42',
        enabled: false,
        sites: ['S1'],
        skipped: '',
        noSelection: [],
      },
    );

    expect(payload).toEqual({
      title: 'Study A',
      count: 42,
      enabled: false,
      sites: ['S1'],
    });
  });
});

describe('hasInvalidObjectInput', () => {
  const fields = [field({ name: 'body', type: 'object' }), field({ name: 'title' })];

  it('is true while an object-typed field holds text that does not parse as a JSON object', () => {
    expect(hasInvalidObjectInput(fields, { body: '{"a": ' })).toBe(true);
    expect(hasInvalidObjectInput(fields, { body: '[1, 2]' })).toBe(true);
    expect(hasInvalidObjectInput(fields, { body: 'null' })).toBe(true);
  });

  it('is false for empty text, valid JSON objects, and already-parsed objects', () => {
    expect(hasInvalidObjectInput(fields, { body: '' })).toBe(false);
    expect(hasInvalidObjectInput(fields, { body: '   ' })).toBe(false);
    expect(hasInvalidObjectInput(fields, {})).toBe(false);
    expect(hasInvalidObjectInput(fields, { body: '{"a": 1}' })).toBe(false);
    expect(hasInvalidObjectInput(fields, { body: { a: 1 } })).toBe(false);
  });

  it('ignores non-object field types', () => {
    expect(hasInvalidObjectInput(fields, { title: 'not json' })).toBe(false);
  });
});
