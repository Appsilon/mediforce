import { describe, it, expect } from 'vitest';
import { validateStepGraph } from '../graph-validator';
import type { ProcessDefinition, Step } from '../process-definition';

function step(id: string, overrides: Partial<Step> = {}): Step {
  return { id, name: id, type: 'creation', ...overrides };
}

function definition(steps: Step[], transitions: ProcessDefinition['transitions'] = []): ProcessDefinition {
  return {
    name: 'wf',
    version: '1',
    steps,
    transitions,
  };
}

describe('validateStepGraph verdict routing', () => {
  it('rejects verdicts on a creation step', () => {
    const def = definition(
      [
        step('start', { verdicts: { approve: { target: 'done' } } }),
        step('done', { type: 'terminal' }),
      ],
      [{ from: 'start', to: 'done' }],
    );
    const result = validateStepGraph(def);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => /Step "start" has verdicts but is type "creation" — verdicts are only valid on review\/decision steps/.test(e),
      ),
    ).toBe(true);
  });

  it('accepts verdicts on a decision step', () => {
    const def = definition([
      step('start', { type: 'decision', verdicts: { approve: { target: 'done' } } }),
      step('done', { type: 'terminal' }),
    ]);
    const result = validateStepGraph(def);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts verdicts on a review step', () => {
    const def = definition([
      step('start', { type: 'review', verdicts: { approve: { target: 'done' } } }),
      step('done', { type: 'terminal' }),
    ]);
    const result = validateStepGraph(def);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('does not count a creation step\'s stray verdicts as outgoing routing (non-terminal with no transitions)', () => {
    const def = definition([
      step('start', { verdicts: { approve: { target: 'done' } } }),
      step('done', { type: 'terminal' }),
    ]);
    const result = validateStepGraph(def);
    expect(
      result.errors.some((e) => /Non-terminal step "start" has no outgoing transitions or verdicts/.test(e)),
    ).toBe(true);
  });

  it('does not treat a creation step\'s verdicts as a `when` exemption for multiple transitions', () => {
    const def = definition(
      [
        step('start', { verdicts: { approve: { target: 'a' } } }),
        step('a', { type: 'terminal' }),
        step('b', { type: 'terminal' }),
      ],
      [
        { from: 'start', to: 'a' },
        { from: 'start', to: 'b' },
      ],
    );
    const result = validateStepGraph(def);
    expect(
      result.errors.some((e) => /Step "start" has multiple outgoing transitions but not all have 'when'/.test(e)),
    ).toBe(true);
  });

  it('exempts a decision step with verdicts from the `when` requirement on multiple transitions', () => {
    const def = definition(
      [
        step('start', { type: 'decision', verdicts: { yes: { target: 'a' }, no: { target: 'b' } } }),
        step('a', { type: 'terminal' }),
        step('b', { type: 'terminal' }),
      ],
      [
        { from: 'start', to: 'a' },
        { from: 'start', to: 'b' },
      ],
    );
    const result = validateStepGraph(def);
    expect(result.errors.some((e) => /not all have 'when'/.test(e))).toBe(false);
  });

  it('follows verdict targets for reachability only on review/decision steps', () => {
    const reachableViaDecision = definition([
      step('start', { type: 'decision', verdicts: { go: { target: 'end' } } }),
      step('end', { type: 'terminal' }),
    ]);
    const decisionResult = validateStepGraph(reachableViaDecision);
    expect(decisionResult.errors.some((e) => /unreachable/.test(e))).toBe(false);

    const reachableViaCreation = definition([
      step('start', { verdicts: { go: { target: 'end' } } }),
      step('end', { type: 'terminal' }),
    ]);
    const creationResult = validateStepGraph(reachableViaCreation);
    expect(creationResult.errors.some((e) => /Step "end" is unreachable from the entry point/.test(e))).toBe(true);
  });
});

describe('validateStepGraph — a fork the engine cannot resolve', () => {
  it('rejects two outgoing transitions when one carries no condition', () => {
    const def = definition(
      [step('check'), step('fix'), step('done', { type: 'terminal' })],
      [
        { from: 'check', to: 'fix', when: 'output.status == "bad"' },
        { from: 'check', to: 'done' },
        { from: 'fix', to: 'done' },
      ],
    );
    const result = validateStepGraph(def);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/"check".*condition/i);
    expect(result.errors.join(' ')).toMatch(/done/);
  });

  it('accepts a single unconditional transition, which is the ordinary case', () => {
    const def = definition(
      [step('check'), step('done', { type: 'terminal' })],
      [{ from: 'check', to: 'done' }],
    );
    expect(validateStepGraph(def).valid).toBe(true);
  });

  it('accepts a fork where every branch is conditioned', () => {
    const def = definition(
      [step('check'), step('fix'), step('done', { type: 'terminal' })],
      [
        { from: 'check', to: 'fix', when: 'output.status == "bad"' },
        { from: 'check', to: 'done', when: 'else' },
        { from: 'fix', to: 'done' },
      ],
    );
    expect(validateStepGraph(def).valid).toBe(true);
  });

  it('leaves a decision step alone: its verdicts are the routing', () => {
    const def = definition(
      [
        step('review', {
          type: 'decision',
          verdicts: { approve: { target: 'done' }, reject: { target: 'fix' } },
        }),
        step('fix'),
        step('done', { type: 'terminal' }),
      ],
      [
        { from: 'review', to: 'done' },
        { from: 'review', to: 'fix' },
        { from: 'fix', to: 'done' },
      ],
    );
    expect(validateStepGraph(def).valid).toBe(true);
  });

  it('rejects a decision step whose transitions mix conditioned and unconditioned', () => {
    const def = definition(
      [
        step('test', {
          type: 'decision',
          verdicts: { pass: { target: 'review' }, fail: { target: 'fix' } },
        }),
        step('fix'),
        step('review'),
        step('done', { type: 'terminal' }),
      ],
      [
        { from: 'test', to: 'review' },
        { from: 'test', to: 'fix', when: 'verdict == "fail"' },
        { from: 'fix', to: 'done' },
        { from: 'review', to: 'done' },
      ],
    );
    const result = validateStepGraph(def);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/"test"/);
    expect(result.errors.join(' ')).toMatch(/some of its transitions carry a condition/i);
  });

});
