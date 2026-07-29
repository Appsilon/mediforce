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
    triggers: [{ type: 'manual', name: 'start' }],
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
