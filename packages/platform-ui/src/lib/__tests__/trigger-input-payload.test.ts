import { describe, it, expect } from 'vitest';
import type { TriggerInputField } from '@mediforce/platform-core';
import {
  buildTriggerPayload,
  hasInvalidObjectInput,
  normalizeTriggerInput,
  parseCronPayloadText,
  triggerInputIssue,
} from '../trigger-input-payload';

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

describe('parseCronPayloadText', () => {
  it('reads empty or blank text as "no payload"', () => {
    expect(parseCronPayloadText('')).toEqual({});
    expect(parseCronPayloadText('   \n ')).toEqual({});
  });

  it('parses a JSON object', () => {
    expect(parseCronPayloadText('{"studyId": "S-1"}')).toEqual({ studyId: 'S-1' });
  });

  it('is null for anything that is not a JSON object, so submit stays blocked', () => {
    expect(parseCronPayloadText('{"a": ')).toBeNull();
    expect(parseCronPayloadText('[1, 2]')).toBeNull();
    expect(parseCronPayloadText('null')).toBeNull();
    expect(parseCronPayloadText('"S-1"')).toBeNull();
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

describe('triggerInputIssue', () => {
  it('accepts a contract that would register', () => {
    expect(
      triggerInputIssue([
        { name: 'studyId', type: 'string', required: true },
        { name: 'phase', type: 'select', required: false, options: ['I', 'II'] },
      ]),
    ).toBeNull();
  });

  it('accepts having no inputs at all', () => {
    expect(triggerInputIssue([])).toBeNull();
  });

  it('names the input that has no name, which the server refuses', () => {
    // `TriggerInputFieldSchema` is `name: z.string().min(1)`, so registering
    // this loses the whole save to a 400 the form could have caught.
    const issue = triggerInputIssue([{ name: '  ', type: 'string', required: false }]);
    expect(issue).toBe('Input 1 needs a name.');
  });

  it('rejects two inputs with the same name, which the schema does not catch', () => {
    // The payload is a JSON object keyed by field name, so a duplicate silently
    // shadows the first field instead of failing anywhere.
    const issue = triggerInputIssue([
      { name: 'studyId', type: 'string', required: false },
      { name: ' studyId ', type: 'number', required: false },
    ]);
    expect(issue).toBe('Two inputs are named studyId. Each name has to be different.');
  });

  it('rejects a choice list with nothing to choose from', () => {
    for (const type of ['select', 'multiselect'] as const) {
      expect(triggerInputIssue([{ name: 'phase', type, required: false }])).toBe(
        'phase is a choice list, so it needs at least one option.',
      );
    }
  });
});

describe('normalizeTriggerInput', () => {
  it('trims the name, since a stray space makes the value unreadable in a step', () => {
    // Steps read a value as ${triggerPayload.<name>}, which cannot name a field
    // with a space in it, so the field would be set and never readable.
    expect(normalizeTriggerInput([{ name: ' studyId ', type: 'string', required: false }])).toEqual([
      { name: 'studyId', type: 'string', required: false },
    ]);
  });

  it('drops a description and options the author left empty', () => {
    expect(
      normalizeTriggerInput([
        { name: 'studyId', type: 'string', required: false, description: '   ', options: [] },
      ]),
    ).toEqual([{ name: 'studyId', type: 'string', required: false }]);
  });

  it('keeps a description and options the author filled', () => {
    expect(
      normalizeTriggerInput([
        { name: 'phase', type: 'select', required: true, description: ' The phase ', options: ['I'] },
      ]),
    ).toEqual([{ name: 'phase', type: 'select', required: true, description: 'The phase', options: ['I'] }]);
  });
});
