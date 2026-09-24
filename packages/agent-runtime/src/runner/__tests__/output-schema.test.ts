import { describe, it, expect } from 'vitest';
import { validateOutputSchema } from '../output-schema';

describe('validateOutputSchema', () => {
  const schema = {
    type: 'object',
    required: ['articles', 'metadata'],
    properties: {
      articles: { type: 'array' },
      metadata: { type: 'object' },
    },
  };

  it('returns null for valid structured output', () => {
    expect(validateOutputSchema({ articles: [], metadata: {} }, schema)).toBeNull();
  });

  it('returns null for valid JSON inside raw wrapper', () => {
    const raw = JSON.stringify({ articles: [{ id: 1 }], metadata: { count: 1 } });
    expect(validateOutputSchema({ raw }, schema)).toBeNull();
  });

  it('returns error for empty output', () => {
    expect(validateOutputSchema({}, schema)).toBe('output is empty');
  });

  it('returns error for non-JSON raw string', () => {
    expect(validateOutputSchema({ raw: "I'll process each source sequentially." }, schema))
      .toBe('output is not valid JSON');
  });

  it('returns error for missing required keys', () => {
    const raw = JSON.stringify({ articles: [] });
    expect(validateOutputSchema({ raw }, schema)).toBe('missing required keys: metadata');
  });

  it('returns error for wrong type', () => {
    const raw = JSON.stringify({ articles: 'not an array', metadata: {} });
    expect(validateOutputSchema({ raw }, schema)).toBe('property "articles" expected array, got string');
  });

  it('passes when no required keys specified', () => {
    const looseSchema = { type: 'object', properties: { report: { type: 'string' } } };
    expect(validateOutputSchema({ report: 'hello' }, looseSchema)).toBeNull();
  });

  it('returns error when raw is an array instead of object', () => {
    expect(validateOutputSchema({ raw: '[]' }, schema))
      .toBe('expected object, got array');
  });

  it('returns error when raw is null', () => {
    expect(validateOutputSchema({ raw: null } as Record<string, unknown>, schema))
      .toBe('output is empty');
  });

  it('returns error when raw is undefined', () => {
    expect(validateOutputSchema({ raw: undefined } as Record<string, unknown>, schema))
      .toBe('output is empty');
  });

  it('returns error when raw is a primitive JSON value', () => {
    expect(validateOutputSchema({ raw: '42' }, schema))
      .toBe('output is not valid JSON');
  });

  it.each([
    ['boolean', 'yes', 'property "flag" expected boolean, got string'],
    ['integer', 2.5, 'property "flag" expected integer, got number'],
    ['integer', '3', 'property "flag" expected integer, got string'],
    ['null', 0, 'property "flag" expected null, got number'],
    ['number', null, 'property "flag" expected number, got null'],
    ['object', [], 'property "flag" expected object, got array'],
  ])('rejects a %s property holding %j', (type, value, message) => {
    const typedSchema = { type: 'object', properties: { flag: { type } } };
    expect(validateOutputSchema({ flag: value }, typedSchema)).toBe(message);
  });

  it.each([
    ['boolean', false],
    ['integer', 3],
    ['null', null],
    ['number', 2.5],
  ])('accepts a %s property holding %j', (type, value) => {
    const typedSchema = { type: 'object', properties: { flag: { type } } };
    expect(validateOutputSchema({ flag: value }, typedSchema)).toBeNull();
  });
});
