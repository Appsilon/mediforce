import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeIssues, parseJson } from '../field-errors';

describe('parseJson', () => {
  it('reads valid JSON', () => {
    expect(parseJson('{"grade": 5}')).toEqual({ value: { grade: 5 } });
  });

  it('names the line a browser reports by line', () => {
    expect(parseJson('{\n  "grade": 5\n  "term": "Sepsis"\n}')).toEqual({ error: 'Not valid JSON (line 3) — check for a missing comma, quote or bracket.' });
  });

  it('works the line out of an offset when that is all a browser gives', () => {
    const parse = JSON.parse;
    JSON.parse = () => { throw new SyntaxError('Unexpected token " in JSON at position 16'); };
    try {
      expect(parseJson('{\n  "grade": 5\n  "term": "Sepsis"\n}')).toEqual({ error: 'Not valid JSON (line 3) — check for a missing comma, quote or bracket.' });
    } finally {
      JSON.parse = parse;
    }
  });
});

describe('describeIssues', () => {
  const schema = z.object({ triggerPayload: z.record(z.string(), z.unknown()), previousStepOutputs: z.record(z.string(), z.unknown()) });
  const problems = (value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? null : describeIssues(parsed.error.issues, value);
  };

  it('says a field is missing, and what to put there', () => {
    expect(problems({ triggerPayload: {} })).toBe('"previousStepOutputs" is missing — add it, even as {}.');
  });

  it('says what a field should be instead of what it is', () => {
    expect(problems({ triggerPayload: [], previousStepOutputs: 'none' }))
      .toBe('"triggerPayload" must be an object { … }, not a list. "previousStepOutputs" must be an object { … }, not text.');
  });

  it('says the whole value must be an object', () => {
    expect(problems(42)).toBe('It must be an object { … }, not a number.');
  });
});
