import { describe, it, expect } from 'vitest';
import {
  resolveTransitions,
  TransitionValidationError,
  NoMatchingTransitionError,
  type TransitionContext,
} from '../transition-resolver.js';

type TestTransition = { from: string; to: string; when?: string };

function makeContext(
  overrides: Partial<TransitionContext> = {},
): TransitionContext {
  return {
    output: {},
    variables: {},
    ...overrides,
  };
}

describe('resolveTransitions', () => {
  describe('unconditional (single transition, no when)', () => {
    it('single transition without when → always taken', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b' },
      ];
      const result = resolveTransitions(transitions, makeContext());
      expect(result).toEqual([{ to: 'b', reason: 'Unconditional transition' }]);
    });
  });

  describe('conditional (when expressions)', () => {
    it('single transition with when that matches → taken', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'output.valid == true' },
      ];
      const ctx = makeContext({ output: { valid: true } });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe('b');
    });

    it('[ERROR] single transition with when that does not match → NoMatchingTransitionError', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'output.valid == true' },
      ];
      const ctx = makeContext({ output: { valid: false } });
      expect(() => resolveTransitions(transitions, ctx)).toThrow(
        NoMatchingTransitionError,
      );
    });

    it('two transitions with mutually exclusive when — first matches', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'output.valid == true' },
        { from: 'a', to: 'c', when: 'output.valid == false' },
      ];
      const ctx = makeContext({ output: { valid: true } });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toEqual([
        { to: 'b', reason: expect.stringContaining('output.valid == true') },
      ]);
    });

    it('two transitions with mutually exclusive when — second matches', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'output.valid == true' },
        { from: 'a', to: 'c', when: 'output.valid == false' },
      ];
      const ctx = makeContext({ output: { valid: false } });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toEqual([
        { to: 'c', reason: expect.stringContaining('output.valid == false') },
      ]);
    });

    it('when: "true" always matches', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'true' },
      ];
      const result = resolveTransitions(transitions, makeContext());
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe('b');
    });

    it('complex when expression with logical operators', () => {
      const transitions: TestTransition[] = [
        {
          from: 'a',
          to: 'b',
          when: 'output.score >= 0.8 && output.status == "ready"',
        },
        { from: 'a', to: 'c', when: 'else' },
      ];
      const ctx = makeContext({
        output: { score: 0.9, status: 'ready' },
      });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe('b');
    });
  });

  describe('parallel fork (multiple matches)', () => {
    it('two transitions both with when: "true" → both returned', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'true' },
        { from: 'a', to: 'c', when: 'true' },
      ];
      const result = resolveTransitions(transitions, makeContext());
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.to)).toEqual(['b', 'c']);
    });

    it('overlapping conditions — both match → both returned (inclusive OR)', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'medical', when: 'output.needsMedical == true' },
        { from: 'a', to: 'legal', when: 'output.needsLegal == true' },
      ];
      const ctx = makeContext({
        output: { needsMedical: true, needsLegal: true },
      });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.to)).toEqual(['medical', 'legal']);
    });

    it('overlapping conditions — only one matches → one returned', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'medical', when: 'output.needsMedical == true' },
        { from: 'a', to: 'legal', when: 'output.needsLegal == true' },
      ];
      const ctx = makeContext({
        output: { needsMedical: true, needsLegal: false },
      });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe('medical');
    });
  });

  describe('else (fallback)', () => {
    it('when: "else" taken when nothing else matches', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'output.type == "premium"' },
        { from: 'a', to: 'c', when: 'output.type == "enterprise"' },
        { from: 'a', to: 'default', when: 'else' },
      ];
      const ctx = makeContext({ output: { type: 'basic' } });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toEqual([
        { to: 'default', reason: 'Default (else) transition' },
      ]);
    });

    it('when: "else" NOT taken when another transition matches', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'output.type == "premium"' },
        { from: 'a', to: 'default', when: 'else' },
      ];
      const ctx = makeContext({ output: { type: 'premium' } });
      const result = resolveTransitions(transitions, ctx);
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe('b');
    });
  });

  describe('validation errors', () => {
    it('[ERROR] multiple transitions, not all with when → TransitionValidationError', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c', when: 'output.valid == true' },
      ];
      expect(() => resolveTransitions(transitions, makeContext())).toThrow(
        TransitionValidationError,
      );
    });

    it('[ERROR] multiple transitions, none with when → TransitionValidationError', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ];
      expect(() => resolveTransitions(transitions, makeContext())).toThrow(
        TransitionValidationError,
      );
    });

    it('[ERROR] no transitions → NoMatchingTransitionError', () => {
      expect(() => resolveTransitions([], makeContext())).toThrow(
        NoMatchingTransitionError,
      );
    });

    it('[ERROR] invalid when expression → TransitionValidationError', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'invalid $$ syntax' },
      ];
      expect(() => resolveTransitions(transitions, makeContext())).toThrow(
        TransitionValidationError,
      );
    });

    it('[ERROR] no matching transitions and no else → NoMatchingTransitionError', () => {
      const transitions: TestTransition[] = [
        { from: 'a', to: 'b', when: 'output.x == true' },
        { from: 'a', to: 'c', when: 'output.y == true' },
      ];
      const ctx = makeContext({ output: { x: false, y: false } });
      expect(() => resolveTransitions(transitions, ctx)).toThrow(
        NoMatchingTransitionError,
      );
    });
  });
});
