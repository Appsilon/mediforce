import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

type Transitions = WorkflowDefinition['transitions'];

/**
 * Returns two sets of step IDs: those that can move up and those that can move
 * down in a linear segment of the workflow graph.
 *
 * A step can move up iff:
 *   - it has exactly one incoming transition, AND
 *   - its predecessor has exactly one outgoing transition (i.e. the swap is
 *     unambiguous — no branching around the swap point).
 *
 * A step can move down iff:
 *   - it has exactly one outgoing transition, AND
 *   - its successor has exactly one incoming transition.
 */
export function computeMoveEligibility(
  steps: WorkflowStep[],
  transitions: Transitions,
): { canMoveUp: Set<string>; canMoveDown: Set<string> } {
  const canMoveUp = new Set<string>();
  const canMoveDown = new Set<string>();

  for (const step of steps) {
    const incoming = transitions.filter((t) => t.to === step.id);
    if (incoming.length === 1) {
      const pred = incoming[0].from;
      if (transitions.filter((t) => t.from === pred).length === 1) {
        canMoveUp.add(step.id);
      }
    }

    const outgoing = transitions.filter((t) => t.from === step.id);
    if (outgoing.length === 1) {
      const succ = outgoing[0].to;
      if (transitions.filter((t) => t.to === succ).length === 1) {
        canMoveDown.add(step.id);
      }
    }
  }

  return { canMoveUp, canMoveDown };
}

/**
 * Ensures every non-terminal step has at least one outgoing transition that
 * points to the terminal step.  If no terminal step exists, one is appended.
 *
 * Returns new arrays only when changes were necessary; otherwise returns the
 * original references so callers can use reference equality to skip updates.
 */
export function ensureTerminalConnected(
  steps: WorkflowStep[],
  transitions: Transitions,
): { steps: WorkflowStep[]; transitions: Transitions } {
  let resultSteps = steps;
  let resultTransitions = transitions;

  let terminal = steps.find((s) => s.type === 'terminal');
  if (!terminal) {
    terminal = { id: 'done', name: 'Done', type: 'terminal', executor: 'human' };
    resultSteps = [...steps, terminal];
  }

  const terminalId = terminal.id;
  const orphans = resultSteps.filter(
    (s) => s.type !== 'terminal' && !resultTransitions.some((t) => t.from === s.id),
  );

  if (orphans.length > 0) {
    resultTransitions = [
      ...resultTransitions,
      ...orphans.map((s) => ({ from: s.id, to: terminalId })),
    ];
  }

  return { steps: resultSteps, transitions: resultTransitions };
}
