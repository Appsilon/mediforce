import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  ExpressionError,
  type ExpressionContext,
} from '../expression-evaluator.js';

function makeContext(
  overrides: Partial<ExpressionContext> = {},
): ExpressionContext {
  return {
    output: {},
    variables: {},
    ...overrides,
  };
}

describe('evaluateExpression', () => {
  describe('boolean literals', () => {
    it('true → true', () => {
      expect(evaluateExpression('true', makeContext())).toBe(true);
    });

    it('false → false', () => {
      expect(evaluateExpression('false', makeContext())).toBe(false);
    });
  });

  describe('field access', () => {
    it('output.valid returns field value', () => {
      const ctx = makeContext({ output: { valid: true } });
      expect(evaluateExpression('output.valid', ctx)).toBe(true);
    });

    it('output.valid returns false when field is false', () => {
      const ctx = makeContext({ output: { valid: false } });
      expect(evaluateExpression('output.valid', ctx)).toBe(false);
    });

    it('output.nested.field is truthy for non-empty string', () => {
      const ctx = makeContext({
        output: { result: { status: 'ok' } },
      });
      // evaluateExpression returns boolean — 'ok' is truthy
      expect(evaluateExpression('output.result.status', ctx)).toBe(true);
    });

    it('variables.amount is truthy for non-zero number', () => {
      const ctx = makeContext({ variables: { amount: 15000 } });
      expect(evaluateExpression('variables.amount', ctx)).toBe(true);
    });

    it('verdict is truthy when set', () => {
      const ctx = makeContext({ verdict: 'approve' });
      expect(evaluateExpression('verdict', ctx)).toBe(true);
    });

    it('output.nonexistent is falsy (null coerced to false)', () => {
      const ctx = makeContext({ output: {} });
      expect(evaluateExpression('output.nonexistent', ctx)).toBe(false);
    });

    it('verdict without value is falsy (null coerced to false)', () => {
      const ctx = makeContext();
      expect(evaluateExpression('verdict', ctx)).toBe(false);
    });

    it('[ERROR] unknown root field throws ExpressionError', () => {
      expect(() =>
        evaluateExpression('unknown.field', makeContext()),
      ).toThrow(ExpressionError);
    });
  });

  describe('comparisons', () => {
    it('output.valid == true → true when valid is true', () => {
      const ctx = makeContext({ output: { valid: true } });
      expect(evaluateExpression('output.valid == true', ctx)).toBe(true);
    });

    it('output.valid == false → false when valid is true', () => {
      const ctx = makeContext({ output: { valid: true } });
      expect(evaluateExpression('output.valid == false', ctx)).toBe(false);
    });

    it('output.valid == false → true when valid is false', () => {
      const ctx = makeContext({ output: { valid: false } });
      expect(evaluateExpression('output.valid == false', ctx)).toBe(true);
    });

    it('output.score >= 0.8 → true when score is 0.85', () => {
      const ctx = makeContext({ output: { score: 0.85 } });
      expect(evaluateExpression('output.score >= 0.8', ctx)).toBe(true);
    });

    it('output.score >= 0.8 → false when score is 0.7', () => {
      const ctx = makeContext({ output: { score: 0.7 } });
      expect(evaluateExpression('output.score >= 0.8', ctx)).toBe(false);
    });

    it('variables.amount > 10000 → true when amount is 15000', () => {
      const ctx = makeContext({ variables: { amount: 15000 } });
      expect(evaluateExpression('variables.amount > 10000', ctx)).toBe(true);
    });

    it('variables.amount > 10000 → false when amount is 5000', () => {
      const ctx = makeContext({ variables: { amount: 5000 } });
      expect(evaluateExpression('variables.amount > 10000', ctx)).toBe(false);
    });

    it('verdict == "approve" → true when verdict matches', () => {
      const ctx = makeContext({ verdict: 'approve' });
      expect(evaluateExpression('verdict == "approve"', ctx)).toBe(true);
    });

    it('verdict == "approve" → false when verdict differs', () => {
      const ctx = makeContext({ verdict: 'revise' });
      expect(evaluateExpression('verdict == "approve"', ctx)).toBe(false);
    });

    it('verdict != "approve" → true when verdict is revise', () => {
      const ctx = makeContext({ verdict: 'revise' });
      expect(evaluateExpression('verdict != "approve"', ctx)).toBe(true);
    });

    it('output.error == null → true when field is undefined', () => {
      const ctx = makeContext({ output: {} });
      expect(evaluateExpression('output.error == null', ctx)).toBe(true);
    });

    it('output.error == null → true when field is null', () => {
      const ctx = makeContext({
        output: { error: null },
      });
      expect(evaluateExpression('output.error == null', ctx)).toBe(true);
    });

    it('output.error != null → true when field has value', () => {
      const ctx = makeContext({
        output: { error: 'something went wrong' },
      });
      expect(evaluateExpression('output.error != null', ctx)).toBe(true);
    });

    it('output.error != null → false when field is missing', () => {
      const ctx = makeContext({ output: {} });
      expect(evaluateExpression('output.error != null', ctx)).toBe(false);
    });

    it('output.count == 5 with strict type matching', () => {
      const ctx = makeContext({ output: { count: 5 } });
      expect(evaluateExpression('output.count == 5', ctx)).toBe(true);
    });

    it('output.status == "active" string comparison', () => {
      const ctx = makeContext({ output: { status: 'active' } });
      expect(evaluateExpression('output.status == "active"', ctx)).toBe(true);
    });

    it('less than: output.score < 0.5', () => {
      const ctx = makeContext({ output: { score: 0.3 } });
      expect(evaluateExpression('output.score < 0.5', ctx)).toBe(true);
    });

    it('less than or equal: output.score <= 0.5', () => {
      const ctx = makeContext({ output: { score: 0.5 } });
      expect(evaluateExpression('output.score <= 0.5', ctx)).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('AND: both true → true', () => {
      const ctx = makeContext({ output: { a: true, b: true } });
      expect(
        evaluateExpression('output.a == true && output.b == true', ctx),
      ).toBe(true);
    });

    it('AND: one false → false', () => {
      const ctx = makeContext({ output: { a: true, b: false } });
      expect(
        evaluateExpression('output.a == true && output.b == true', ctx),
      ).toBe(false);
    });

    it('OR: one true → true', () => {
      const ctx = makeContext({ output: { a: false, b: true } });
      expect(
        evaluateExpression('output.a == true || output.b == true', ctx),
      ).toBe(true);
    });

    it('OR: both false → false', () => {
      const ctx = makeContext({ output: { a: false, b: false } });
      expect(
        evaluateExpression('output.a == true || output.b == true', ctx),
      ).toBe(false);
    });

    it('NOT: negates boolean', () => {
      const ctx = makeContext({ output: { valid: true } });
      expect(evaluateExpression('!(output.valid == true)', ctx)).toBe(false);
    });

    it('NOT: double negation', () => {
      const ctx = makeContext({ output: { valid: true } });
      expect(evaluateExpression('!!(output.valid == true)', ctx)).toBe(true);
    });

    it('grouping with parentheses: (a || b) && c', () => {
      const ctx = makeContext({ output: { a: false, b: true, c: true } });
      expect(
        evaluateExpression(
          '(output.a == true || output.b == true) && output.c == true',
          ctx,
        ),
      ).toBe(true);
    });

    it('grouping: (a || b) && c — c is false', () => {
      const ctx = makeContext({ output: { a: false, b: true, c: false } });
      expect(
        evaluateExpression(
          '(output.a == true || output.b == true) && output.c == true',
          ctx,
        ),
      ).toBe(false);
    });

    it('operator precedence: && binds tighter than ||', () => {
      // a || b && c  →  a || (b && c)
      const ctx = makeContext({ output: { a: true, b: false, c: false } });
      expect(
        evaluateExpression(
          'output.a == true || output.b == true && output.c == true',
          ctx,
        ),
      ).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles extra whitespace', () => {
      const ctx = makeContext({ output: { valid: true } });
      expect(evaluateExpression('  output.valid  ==  true  ', ctx)).toBe(true);
    });

    it('[ERROR] empty expression throws ExpressionError', () => {
      expect(() => evaluateExpression('', makeContext())).toThrow(
        ExpressionError,
      );
    });

    it('[ERROR] whitespace-only expression throws ExpressionError', () => {
      expect(() => evaluateExpression('   ', makeContext())).toThrow(
        ExpressionError,
      );
    });

    it('[ERROR] incomplete expression throws ExpressionError', () => {
      expect(() =>
        evaluateExpression('output.valid ==', makeContext()),
      ).toThrow(ExpressionError);
    });

    it('[ERROR] invalid characters throw ExpressionError', () => {
      expect(() =>
        evaluateExpression('output.valid $$ true', makeContext()),
      ).toThrow(ExpressionError);
    });

    it('[ERROR] unclosed parenthesis throws ExpressionError', () => {
      expect(() =>
        evaluateExpression('(output.valid == true', makeContext()),
      ).toThrow(ExpressionError);
    });

    it('[ERROR] unclosed string throws ExpressionError', () => {
      expect(() =>
        evaluateExpression('verdict == "approve', makeContext()),
      ).toThrow(ExpressionError);
    });

    it('negative numbers: output.temp > -10', () => {
      const ctx = makeContext({ output: { temp: 5 } });
      expect(evaluateExpression('output.temp > -10', ctx)).toBe(true);
    });

    it('string with escaped quote: output.msg == "say \\"hello\\""', () => {
      const ctx = makeContext({ output: { msg: 'say "hello"' } });
      expect(
        evaluateExpression('output.msg == "say \\"hello\\""', ctx),
      ).toBe(true);
    });
  });
});
