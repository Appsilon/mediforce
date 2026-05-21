import { describe, it, expect } from 'vitest';
import { computeMoveEligibility, ensureTerminalConnected } from '../workflow-editor-utils';
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
