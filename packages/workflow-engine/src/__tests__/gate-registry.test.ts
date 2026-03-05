import { describe, it, expect, beforeEach } from 'vitest';
import {
  GateRegistry,
  GateNotFoundError,
  GateExecutionError,
  alwaysProceed,
  createSimpleReviewGate,
} from '../index.js';
import type { GateFunction, GateInput } from '../index.js';

function makeInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    stepId: 'test-step',
    stepOutput: {},
    processVariables: {},
    ...overrides,
  };
}

describe('GateRegistry', () => {
  let registry: GateRegistry;

  beforeEach(() => {
    registry = new GateRegistry();
  });

  it('registers and retrieves a gate function', () => {
    const gate: GateFunction = () => ({ next: 'step-b', reason: 'test' });
    registry.register('my-gate', gate);
    expect(registry.get('my-gate')).toBe(gate);
  });

  it('has() returns true for registered gate', () => {
    const gate: GateFunction = () => ({ next: 'step-b', reason: 'test' });
    registry.register('my-gate', gate);
    expect(registry.has('my-gate')).toBe(true);
  });

  it('has() returns false for unregistered gate', () => {
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('get() throws GateNotFoundError for missing gate', () => {
    expect(() => registry.get('missing')).toThrowError(GateNotFoundError);
    try {
      registry.get('missing');
    } catch (err) {
      expect(err).toBeInstanceOf(GateNotFoundError);
      expect((err as Error).message).toContain('missing');
      expect((err as Error).message).toContain('not registered');
    }
  });

  it('register() throws on duplicate registration', () => {
    const gate: GateFunction = () => ({ next: 'a', reason: 'test' });
    registry.register('dup-gate', gate);
    expect(() => registry.register('dup-gate', gate)).toThrowError();
  });

  it('invoke() calls the gate and returns result', () => {
    const gate: GateFunction = (input) => ({
      next: 'routed',
      reason: `routed from ${input.stepId}`,
    });
    registry.register('router', gate);
    const result = registry.invoke('router', makeInput({ stepId: 'origin' }));
    expect(result).toEqual({ next: 'routed', reason: 'routed from origin' });
  });

  it('invoke() wraps gate throws in GateExecutionError', () => {
    const badGate: GateFunction = () => {
      throw new Error('kaboom');
    };
    registry.register('bad-gate', badGate);
    expect(() => registry.invoke('bad-gate', makeInput())).toThrowError(
      GateExecutionError,
    );
    try {
      registry.invoke('bad-gate', makeInput());
    } catch (err) {
      expect(err).toBeInstanceOf(GateExecutionError);
      expect((err as GateExecutionError).message).toContain('kaboom');
      expect((err as GateExecutionError).message).toContain('bad-gate');
    }
  });

  it('invoke() passes GateNotFoundError through (not wrapped)', () => {
    expect(() => registry.invoke('nonexistent', makeInput())).toThrowError(
      GateNotFoundError,
    );
    try {
      registry.invoke('nonexistent', makeInput());
    } catch (err) {
      expect(err).toBeInstanceOf(GateNotFoundError);
      expect(err).not.toBeInstanceOf(GateExecutionError);
    }
  });

  it('clear() removes all registered gates', () => {
    const gate: GateFunction = () => ({ next: 'a', reason: 'test' });
    registry.register('gate-1', gate);
    registry.register('gate-2', gate);
    registry.clear();
    expect(registry.has('gate-1')).toBe(false);
    expect(registry.has('gate-2')).toBe(false);
    expect(registry.names()).toHaveLength(0);
  });

  it('names() returns all registered gate names', () => {
    const gate: GateFunction = () => ({ next: 'a', reason: 'test' });
    registry.register('alpha', gate);
    registry.register('beta', gate);
    registry.register('gamma', gate);
    const names = registry.names();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('gamma');
    expect(names).toHaveLength(3);
  });
});

describe('built-in gates', () => {
  it('alwaysProceed returns reason "Unconditional transition"', () => {
    const result = alwaysProceed(makeInput());
    expect(result.reason).toBe('Unconditional transition');
    expect(result.next).toBe('');
  });

  it('createSimpleReviewGate routes approve/revise/reject correctly', () => {
    const gate = createSimpleReviewGate({
      approve: 'approved-step',
      revise: 'draft-step',
      reject: 'rejected-step',
    });

    const approveResult = gate(
      makeInput({
        reviewVerdicts: [
          {
            reviewerId: 'r1',
            reviewerRole: 'reviewer',
            verdict: 'approve',
            comment: null,
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    expect(approveResult.next).toBe('approved-step');

    const reviseResult = gate(
      makeInput({
        reviewVerdicts: [
          {
            reviewerId: 'r1',
            reviewerRole: 'reviewer',
            verdict: 'revise',
            comment: 'Needs work',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    expect(reviseResult.next).toBe('draft-step');

    const rejectResult = gate(
      makeInput({
        reviewVerdicts: [
          {
            reviewerId: 'r1',
            reviewerRole: 'reviewer',
            verdict: 'reject',
            comment: 'Not acceptable',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    expect(rejectResult.next).toBe('rejected-step');
  });
});
