import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseToolArguments } from '../tool-arguments';

const ProposeEvaluatorSchema = z.object({
  name: z.string().min(1),
  check: z.object({ kind: z.enum(['schema', 'code']) }),
});

describe('parseToolArguments', () => {
  it('returns the parsed arguments when they match', () => {
    const parsed = parseToolArguments('propose_evaluator', ProposeEvaluatorSchema, {
      name: 'findings-present',
      check: { kind: 'schema' },
    });
    expect(parsed).toEqual({ ok: true, data: { name: 'findings-present', check: { kind: 'schema' } } });
  });

  it('names the path, the complaint and what the model sent there', () => {
    const parsed = parseToolArguments('propose_evaluator', ProposeEvaluatorSchema, {
      name: 'grade-check',
      check: { kind: 'regex' },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("Invalid arguments for 'propose_evaluator'");
    expect(parsed.error).toContain("check.kind");
    expect(parsed.error).toContain(`(you sent for 'check.kind': "regex")`);
  });

  it('falls back to the nearest parent the model did send when the field is missing', () => {
    const parsed = parseToolArguments('propose_evaluator', ProposeEvaluatorSchema, { name: 'x', check: {} });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain(`(you sent for 'check': {})`);
  });

  it('appends the caller-supplied hint for an issue', () => {
    const parsed = parseToolArguments(
      'propose_evaluator',
      ProposeEvaluatorSchema,
      { check: { kind: 'schema' } },
      (issue) => (issue.path[0] === 'name' ? ' — name the rule in kebab-case' : ''),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('— name the rule in kebab-case');
  });
});
