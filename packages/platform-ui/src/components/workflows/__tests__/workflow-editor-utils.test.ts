import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeMoveEligibility, ensureTerminalConnected, retargetVerdictTargets, bridgeTargetForDeletion, spliceStepIntoTransitions, retargetCarryOver, pruneCarryOver, splitPastedDefinition } from '../workflow-editor-utils';
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
    expect(result.nonGraph).toEqual({ name: 'kept' });
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
  const files = globSync('apps/*/src/*.wd.json', { cwd: resolve(__dirname, '../../../../../..') })
    .map((rel) => resolve(__dirname, '../../../../../..', rel));

  it('finds the shipped packages', () => {
    expect(files.length).toBeGreaterThan(0);
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
