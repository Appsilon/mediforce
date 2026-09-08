import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeMoveEligibility, ensureTerminalConnected, retargetVerdictTargets, bridgeTargetForDeletion, spliceStepIntoTransitions, retargetCarryOver, pruneCarryOver, splitPastedDefinition, pastedWorkflowName } from '../workflow-editor-utils';
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

// ---------------------------------------------------------------------------
// spliceStepIntoTransitions
// ---------------------------------------------------------------------------

describe('spliceStepIntoTransitions', () => {
  const branching = [
    { from: 'pick', to: 'upload', when: 'output.choice == "upload"' },
    { from: 'pick', to: 'build', when: 'output.choice == "demo"' },
  ];

  it('[UNIT] keeps the split branch condition on the edge into the new step', () => {
    const result = spliceStepIntoTransitions(branching, 'pick', 'upload', 'confirm');

    expect(result).toContainEqual({ from: 'pick', to: 'confirm', when: 'output.choice == "upload"' });
    expect(result).toContainEqual({ from: 'confirm', to: 'upload' });
    // The branch that was not split is untouched, so every path out of `pick`
    // still carries a condition.
    expect(result).toContainEqual(branching[1]);
    expect(result.filter((t) => t.from === 'pick').every((t) => t.when !== undefined)).toBe(true);
  });

  it('[UNIT] carries every condition over when the new step takes the whole outgoing', () => {
    const result = spliceStepIntoTransitions(branching, 'pick', null, 'confirm');

    expect(result).toContainEqual({ from: 'pick', to: 'confirm' });
    expect(result).toContainEqual({ from: 'confirm', to: 'upload', when: 'output.choice == "upload"' });
    expect(result).toContainEqual({ from: 'confirm', to: 'build', when: 'output.choice == "demo"' });
  });

  it('[UNIT] leaves an unconditional split unconditional', () => {
    const result = spliceStepIntoTransitions([tr('a', 'b')], 'a', 'b', 'mid');

    expect(result).toEqual([{ from: 'a', to: 'mid' }, { from: 'mid', to: 'b' }]);
  });
});

describe('retargetCarryOver', () => {
  const entries = [
    { stepId: 'scan', output: 'cursor', as: 'cursor' },
    { stepId: 'review', output: 'notes', as: 'notes' },
  ];

  it('points entries at the renamed step', () => {
    expect(retargetCarryOver(entries, 'scan', 'poll')).toEqual([
      { stepId: 'poll', output: 'cursor', as: 'cursor' },
      { stepId: 'review', output: 'notes', as: 'notes' },
    ]);
  });

  it('returns the same reference when no entry names the renamed step', () => {
    expect(retargetCarryOver(entries, 'done', 'finish')).toBe(entries);
  });

  it('tolerates a workflow without carry-over', () => {
    expect(retargetCarryOver(undefined, 'scan', 'poll')).toBeUndefined();
  });
});

describe('pruneCarryOver', () => {
  const steps = [step('scan'), step('done', 'terminal')];

  it('drops entries whose step no longer exists', () => {
    const entries = [
      { stepId: 'scan', output: 'cursor', as: 'cursor' },
      { stepId: 'deleted', output: 'notes', as: 'notes' },
    ];
    expect(pruneCarryOver(entries, steps)).toEqual([
      { stepId: 'scan', output: 'cursor', as: 'cursor' },
    ]);
  });

  it('returns the same reference when every entry still resolves', () => {
    const entries = [{ stepId: 'scan', output: 'cursor', as: 'cursor' }];
    expect(pruneCarryOver(entries, steps)).toBe(entries);
  });

  it('tolerates a workflow without carry-over', () => {
    expect(pruneCarryOver(undefined, steps)).toBeUndefined();
  });
});

describe('splitPastedDefinition', () => {
  const graph = { steps: [{ id: 'a', name: 'A', type: 'creation', executor: 'human' }], transitions: [{ from: 'a', to: 'done' }] };

  it('applies the non-graph fields instead of refusing them', () => {
    const result = splitPastedDefinition({
      ...graph,
      title: 'Pasted',
      preamble: 'House rules',
      triggerInput: [{ name: 'studyId', type: 'string', required: true }],
    });
    expect(result.error).toBeNull();
    expect(result.nonGraph).toMatchObject({
      title: 'Pasted',
      preamble: 'House rules',
      triggerInput: [{ name: 'studyId', type: 'string' }],
    });
  });

  it('names the fields it overwrote rather than dropping them in silence', () => {
    const result = splitPastedDefinition({
      ...graph,
      name: 'kept',
      namespace: 'other-workspace',
      version: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.error).toBeNull();
    expect(result.ignored.sort()).toEqual(['createdAt', 'name', 'namespace', 'version']);
    expect(result.nonGraph).toEqual({});
  });

  it('overwrites the pasted name, which the page and the route own', () => {
    // A package's `name` is its id, and where a definition registers is decided
    // by the route (an existing workflow's editor) or the name field (the create
    // page). Applying it registered the paste under the *pasted* name, which in
    // an existing workflow's editor silently forked a second workflow, and on
    // the create page put an id where a person's name for it belongs.
    const result = splitPastedDefinition({ ...graph, name: 'landing-zone-CDISCPILOT01' });
    expect(result.nonGraph.name).toBeUndefined();
    expect(result.ignored).toEqual(['name']);
  });

  it('reports nothing ignored when the document carries only authorable fields', () => {
    expect(splitPastedDefinition({ ...graph, title: 'T' }).ignored).toEqual([]);
  });

  it('drops the server-assigned fields a copied definition carries', () => {
    const result = splitPastedDefinition({
      ...graph,
      name: 'kept',
      version: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      namespace: 'other-workspace',
      copiedFrom: { name: 'x', version: 1 },
      source: 'git',
      archived: true,
      deleted: false,
    });
    expect(result.error).toBeNull();
    expect(result.nonGraph).toEqual({});
  });

  it('separates the graph the canvas owns from everything else', () => {
    const result = splitPastedDefinition({
      ...graph,
      inputForNextRun: [{ from: 'a', as: 'carry' }],
      title: 'T',
    });
    expect(result.graph.steps).toHaveLength(1);
    expect(result.graph.transitions).toEqual([{ from: 'a', to: 'done' }]);
    expect(result.graph.inputForNextRun).toEqual([{ from: 'a', as: 'carry' }]);
    expect(result.nonGraph).toEqual({ title: 'T' });
  });

  it('reports the offending field when a non-graph value is invalid', () => {
    const result = splitPastedDefinition({ ...graph, visibility: 'sideways' });
    expect(result.error).toContain('visibility');
  });

  it('rejects a document that is not an object', () => {
    expect(splitPastedDefinition([]).error).not.toBeNull();
  });
});

// The bug this closes: a definition copied out of a registered version could
// never be pasted back, because the panel compared every non-graph field
// against page state and refused on any difference. These are the real
// packages, so a field a shipped workflow uses cannot regress un-pasteable.
describe('splitPastedDefinition — round-trips the packages we ship', () => {
  const files = globSync('apps/**/src/*.wd.json', { cwd: resolve(__dirname, '../../../../../..') })
    .map((rel) => resolve(__dirname, '../../../../../..', rel));

  it('finds every shipped package, including the nested ones', () => {
    // Pinned, not `> 0`: the non-recursive glob this replaced matched 16 of 20
    // and passed. Bump this when a package is added.
    expect(files.length).toBe(20);
  });

  for (const file of files) {
    const name = file.split('/').slice(-1)[0];
    it(`applies every non-graph field in ${name}`, () => {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const result = splitPastedDefinition(doc);
      expect(result.error).toBeNull();
    });
  }
});

describe('pastedWorkflowName', () => {
  it('takes the title, which is what a person calls the workflow', () => {
    // The failure this replaces: a definition carrying
    // `name: 'landing-zone-CDISCPILOT01'` and
    // `title: 'Landing Zone — CDISCPILOT01'` filled the name field with the id,
    // so the workflow was saved with the id as its display name while the
    // version was named correctly.
    expect(pastedWorkflowName({
      name: 'landing-zone-CDISCPILOT01',
      title: 'Landing Zone — CDISCPILOT01',
    })).toBe('Landing Zone — CDISCPILOT01');
  });

  it('falls back to the id when the paste carries no title', () => {
    expect(pastedWorkflowName({ name: 'landing-zone' })).toBe('landing-zone');
  });

  it('ignores a blank title', () => {
    expect(pastedWorkflowName({ name: 'landing-zone', title: '   ' })).toBe('landing-zone');
  });

  it('returns null when the paste names the workflow neither way', () => {
    expect(pastedWorkflowName({ description: 'no name here' })).toBeNull();
  });
});
