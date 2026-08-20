import { describe, it, expect } from 'vitest';
import { computeMoveEligibility, ensureTerminalConnected, retargetVerdictTargets, bridgeTargetForDeletion, nonGraphFieldsDiffer } from '../workflow-editor-utils';
import type { WorkflowStep } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function step(id: string, type: WorkflowStep['type'] = 'creation'): WorkflowStep {
  return { id, name: id, type, executor: 'human' };
}

function tr(from: string, to: string) {
  return { from, to };
}

// ---------------------------------------------------------------------------
// computeMoveEligibility
// ---------------------------------------------------------------------------

describe('retargetVerdictTargets', () => {
  function decision(id: string, verdicts: Record<string, string>): WorkflowStep {
    return {
      id, name: id, type: 'decision', executor: 'human',
      verdicts: Object.fromEntries(
        Object.entries(verdicts).map(([k, target]) => [k, { target }]),
      ),
    };
  }

  it('repoints only the matching verdict target on the scoped step (edge split)', () => {
    const steps = [decision('review', { approve: 'ship', reject: 'done' }), step('inserted'), step('ship'), step('done', 'terminal')];
    const out = retargetVerdictTargets(steps, 'review', 'ship', 'inserted');
    expect(out[0].verdicts).toEqual({ approve: { target: 'inserted' }, reject: { target: 'done' } });
  });

  it('match=null repoints every verdict of the scoped step', () => {
    const steps = [decision('review', { approve: 'ship', reject: 'done' }), step('inserted')];
    const out = retargetVerdictTargets(steps, 'review', null, 'inserted');
    expect(out[0].verdicts).toEqual({ approve: { target: 'inserted' }, reject: { target: 'inserted' } });
  });

  it('scope=null repoints the matching target across every step (insert before terminal)', () => {
    const steps = [decision('a', { cancel: 'done' }), decision('b', { reject: 'done', approve: 'a' }), step('inserted'), step('done', 'terminal')];
    const out = retargetVerdictTargets(steps, null, 'done', 'inserted');
    expect(out[0].verdicts).toEqual({ cancel: { target: 'inserted' } });
    expect(out[1].verdicts).toEqual({ reject: { target: 'inserted' }, approve: { target: 'a' } });
  });

  it('leaves steps without verdicts untouched and returns the same reference on no-op', () => {
    const steps = [decision('review', { approve: 'ship' }), step('plain')];
    const noop = retargetVerdictTargets(steps, 'review', 'nonexistent', 'inserted');
    expect(noop).toBe(steps);
  });

  it('does not scope to a step that is not the target of the edit', () => {
    const steps = [decision('a', { go: 'x' }), decision('b', { go: 'x' })];
    const out = retargetVerdictTargets(steps, 'a', 'x', 'inserted');
    expect(out[0].verdicts).toEqual({ go: { target: 'inserted' } });
    expect(out[1].verdicts).toEqual({ go: { target: 'x' } });
  });

  it('a step literally named "any" is scoped as an id, not a match-everything sentinel', () => {
    const steps = [decision('any', { go: 'x' }), decision('other', { go: 'x' })];
    const out = retargetVerdictTargets(steps, 'any', 'x', 'inserted');
    expect(out[0].verdicts).toEqual({ go: { target: 'inserted' } });
    expect(out[1].verdicts).toEqual({ go: { target: 'x' } }); // untouched — 'any' is a real id here
  });

  it('a verdict target literally named "all" is matched exactly, not as a wildcard', () => {
    const steps = [decision('d', { go: 'all', stay: 'here' })];
    const out = retargetVerdictTargets(steps, 'd', 'all', 'inserted');
    expect(out[0].verdicts).toEqual({ go: { target: 'inserted' }, stay: { target: 'here' } });
  });
});

describe('bridgeTargetForDeletion', () => {
  it("returns the deleted step's first outgoing target", () => {
    const steps = [step('a'), step('b'), step('done', 'terminal')];
    const transitions = [tr('a', 'b'), tr('b', 'done')];
    expect(bridgeTargetForDeletion(steps, transitions, 'b')).toBe('done');
  });

  it('falls back to the terminal step when the deleted step has no outgoing transition', () => {
    const steps = [step('a'), step('orphan'), step('done', 'terminal')];
    const transitions = [tr('a', 'done')];
    expect(bridgeTargetForDeletion(steps, transitions, 'orphan')).toBe('done');
  });

  it('returns undefined when there is neither an outgoing transition nor a terminal', () => {
    const steps = [step('a'), step('b')];
    expect(bridgeTargetForDeletion(steps, [], 'b')).toBeUndefined();
  });
});

describe('nonGraphFieldsDiffer', () => {
  it('is false when only steps/transitions changed', () => {
    const wd = { title: 'T', triggers: [{ type: 'manual', name: 'start' }] };
    const doc = { ...wd, steps: [{ id: 'a' }], transitions: [] };
    expect(nonGraphFieldsDiffer(doc, wd)).toBe(false);
  });

  it('is false when non-graph keys are merely reordered (order-insensitive)', () => {
    const wd = { title: 'T', triggers: [{ type: 'manual', name: 'start' }] };
    const doc = { triggers: [{ name: 'start', type: 'manual' }], steps: [], transitions: [], title: 'T' };
    expect(nonGraphFieldsDiffer(doc, wd)).toBe(false);
  });

  it('is true when a non-graph field value changed', () => {
    const wd = { title: 'T', triggers: [] };
    const doc = { title: 'Different', triggers: [], steps: [], transitions: [] };
    expect(nonGraphFieldsDiffer(doc, wd)).toBe(true);
  });

  it('treats missing wdJsonFields as empty', () => {
    expect(nonGraphFieldsDiffer({ steps: [], transitions: [] }, undefined)).toBe(false);
    expect(nonGraphFieldsDiffer({ title: 'X', steps: [] }, undefined)).toBe(true);
  });
});

describe('computeMoveEligibility', () => {
  it('returns empty sets for a single step with no transitions', () => {
    const { canMoveUp, canMoveDown } = computeMoveEligibility([step('a')], []);
    expect(canMoveUp.size).toBe(0);
    expect(canMoveDown.size).toBe(0);
  });

  it('allows move-up for the second step in a linear chain', () => {
    // a → b → c
    const steps = [step('a'), step('b'), step('c')];
    const transitions = [tr('a', 'b'), tr('b', 'c')];
    const { canMoveUp, canMoveDown } = computeMoveEligibility(steps, transitions);
    expect(canMoveUp.has('b')).toBe(true);
    expect(canMoveUp.has('a')).toBe(false); // no predecessor
  });

  it('allows move-down for every step except the last in a linear chain', () => {
    // a → b → c
    const steps = [step('a'), step('b'), step('c')];
    const transitions = [tr('a', 'b'), tr('b', 'c')];
    const { canMoveDown } = computeMoveEligibility(steps, transitions);
    expect(canMoveDown.has('a')).toBe(true);
    expect(canMoveDown.has('b')).toBe(true);
    expect(canMoveDown.has('c')).toBe(false); // no successor
  });

  it('disallows move-up when predecessor has multiple outgoing edges (branch)', () => {
    // a → b and a → c  (b cannot swap with a)
    const steps = [step('a'), step('b'), step('c')];
    const transitions = [tr('a', 'b'), tr('a', 'c')];
    const { canMoveUp } = computeMoveEligibility(steps, transitions);
    expect(canMoveUp.has('b')).toBe(false);
    expect(canMoveUp.has('c')).toBe(false);
  });

  it('disallows move-down when successor has multiple incoming edges (merge)', () => {
    // a → c and b → c  (a cannot swap with c)
    const steps = [step('a'), step('b'), step('c')];
    const transitions = [tr('a', 'c'), tr('b', 'c')];
    const { canMoveDown } = computeMoveEligibility(steps, transitions);
    expect(canMoveDown.has('a')).toBe(false);
    expect(canMoveDown.has('b')).toBe(false);
  });

  it('handles a longer linear chain correctly', () => {
    // a → b → c → d
    const steps = [step('a'), step('b'), step('c'), step('d')];
    const transitions = [tr('a', 'b'), tr('b', 'c'), tr('c', 'd')];
    const { canMoveUp, canMoveDown } = computeMoveEligibility(steps, transitions);
    // Every step except the first can move up
    expect(canMoveUp.has('a')).toBe(false);
    expect(canMoveUp.has('b')).toBe(true);
    expect(canMoveUp.has('c')).toBe(true);
    expect(canMoveUp.has('d')).toBe(true);
    // Every step except the last can move down
    expect(canMoveDown.has('a')).toBe(true);
    expect(canMoveDown.has('b')).toBe(true);
    expect(canMoveDown.has('c')).toBe(true);
    expect(canMoveDown.has('d')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureTerminalConnected
// ---------------------------------------------------------------------------

describe('ensureTerminalConnected', () => {
  it('returns original references when nothing needs fixing', () => {
    const steps = [step('a'), step('done', 'terminal')];
    const transitions = [tr('a', 'done')];
    const result = ensureTerminalConnected(steps, transitions);
    expect(result.steps).toBe(steps);
    expect(result.transitions).toBe(transitions);
  });

  it('auto-adds a terminal step when none exists', () => {
    const steps = [step('a')];
    const transitions: ReturnType<typeof tr>[] = [];
    const result = ensureTerminalConnected(steps, transitions);
    expect(result.steps.some((s) => s.type === 'terminal')).toBe(true);
    expect(result.steps.length).toBe(2);
  });

  it('connects an orphaned step (no outgoing transition) to the terminal', () => {
    const steps = [step('a'), step('b'), step('done', 'terminal')];
    // 'b' has no outgoing transition
    const transitions = [tr('a', 'done')];
    const result = ensureTerminalConnected(steps, transitions);
    expect(result.transitions.some((t) => t.from === 'b' && t.to === 'done')).toBe(true);
  });

  it('connects multiple orphaned steps to the terminal', () => {
    const steps = [step('a'), step('b'), step('c'), step('done', 'terminal')];
    const transitions: ReturnType<typeof tr>[] = [];
    const result = ensureTerminalConnected(steps, transitions);
    const toTerminal = result.transitions.filter((t) => t.to === 'done');
    expect(toTerminal.map((t) => t.from).sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not add a duplicate transition for a step already pointing to terminal', () => {
    const steps = [step('a'), step('b'), step('done', 'terminal')];
    const transitions = [tr('a', 'done')]; // 'b' is orphaned
    const result = ensureTerminalConnected(steps, transitions);
    const aToTerminal = result.transitions.filter((t) => t.from === 'a' && t.to === 'done');
    expect(aToTerminal.length).toBe(1); // no duplicate
  });

  it('auto-adds terminal AND connects orphans in a single call', () => {
    // No terminal step, no transitions — both fixes in one pass
    const steps = [step('a'), step('b')];
    const transitions: ReturnType<typeof tr>[] = [];
    const result = ensureTerminalConnected(steps, transitions);
    const terminal = result.steps.find((s) => s.type === 'terminal');
    expect(terminal).toBeDefined();
    expect(result.transitions.every((t) => t.to === terminal!.id)).toBe(true);
    expect(result.transitions.length).toBe(2); // a→done, b→done
  });

  it('does not modify transitions for the terminal step itself', () => {
    const steps = [step('a'), step('done', 'terminal')];
    const transitions: ReturnType<typeof tr>[] = [];
    const result = ensureTerminalConnected(steps, transitions);
    // terminal should not get an outgoing transition to itself
    expect(result.transitions.some((t) => t.from === 'done')).toBe(false);
  });

  it('does not treat review steps with verdict targets as orphans', () => {
    const reviewStep: WorkflowStep = {
      id: 'review',
      name: 'Review',
      type: 'review',
      executor: 'human',
      verdicts: {
        approve: { target: 'next-step' },
        revise: { target: 'prev-step' },
      },
    };
    const steps = [step('prev-step'), reviewStep, step('next-step'), step('done', 'terminal')];
    const transitions = [tr('prev-step', 'review'), tr('next-step', 'done')];
    const result = ensureTerminalConnected(steps, transitions);
    // review step should NOT get a phantom transition to done
    expect(result.transitions.some((t) => t.from === 'review' && t.to === 'done')).toBe(false);
  });
});
