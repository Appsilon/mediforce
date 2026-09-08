import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

type Transitions = WorkflowDefinition['transitions'];
type CarryOverEntries = NonNullable<WorkflowDefinition['inputForNextRun']>;

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
 * Rewire `verdicts[*].target` when a step is inserted onto an edge or removed.
 *
 * Review/decision steps route by their verdict targets, independently of plain
 * transitions. A canvas edit that rewires only transitions leaves verdicts
 * pointing at the old target, so the engine routes straight there at runtime —
 * skipping an inserted step, or dangling on a deleted one. This applies the same
 * target remap to verdicts that the transition rewiring applies to edges.
 *
 * `scope` is a step id (only that step's verdicts) or `null` (every step).
 * `match` is the target id to repoint, or `null` to repoint every verdict of the
 * scoped step(s). `null` is used (rather than a string sentinel) so a real step
 * id or verdict target — both slugs, which could legitimately be "any"/"all" —
 * can never collide with the "match everything" case. Returns a new array only
 * when something changed; otherwise the original reference.
 */
export function retargetVerdictTargets(
  steps: WorkflowStep[],
  scope: string | null,
  match: string | null,
  newTarget: string,
): WorkflowStep[] {
  let changed = false;
  const next = steps.map((step) => {
    if (scope !== null && step.id !== scope) return step;
    if (!step.verdicts) return step;
    let stepChanged = false;
    const verdicts = Object.fromEntries(
      Object.entries(step.verdicts).map(([key, verdict]) => {
        if ((match === null || verdict.target === match) && verdict.target !== newTarget) {
          stepChanged = true;
          return [key, { ...verdict, target: newTarget }];
        }
        return [key, verdict];
      }),
    );
    if (!stepChanged) return step;
    changed = true;
    return { ...step, verdicts };
  });
  return changed ? next : steps;
}

/**
 * Transitions after splicing `newId` in below `afterId`.
 *
 * `beforeId` names the single outgoing branch to split; that branch's `when`
 * moves onto the edge into the new step, so a conditional path stays
 * conditional and a multi-branch step keeps a condition on every outgoing edge.
 * Without `beforeId` the new step takes over the whole outgoing fan, and each
 * rewired edge carries its own condition with it.
 */
export function spliceStepIntoTransitions(
  transitions: Transitions,
  afterId: string,
  beforeId: string | null,
  newId: string,
): Transitions {
  if (beforeId !== null) {
    const isSplit = (t: Transitions[number]) => t.from === afterId && t.to === beforeId;
    const split = transitions.filter(isSplit);
    const intoNew = split.length > 0
      ? split.map((t) => ({ from: afterId, to: newId, ...(t.when !== undefined ? { when: t.when } : {}) }))
      : [{ from: afterId, to: newId }];
    return [...transitions.filter((t) => isSplit(t) === false), ...intoNew, { from: newId, to: beforeId }];
  }
  const outgoing = transitions.filter((t) => t.from === afterId);
  return [
    ...transitions.filter((t) => t.from !== afterId),
    { from: afterId, to: newId },
    ...outgoing.map((t) => ({ from: newId, to: t.to, ...(t.when !== undefined ? { when: t.when } : {}) })),
  ];
}

/**
 * The step a deleted node's dangling verdicts should bridge to: the node's first
 * outgoing transition target, falling back to the terminal step. `undefined`
 * only when neither exists (nothing sensible to bridge to).
 */
export function bridgeTargetForDeletion(
  steps: WorkflowStep[],
  transitions: Transitions,
  stepId: string,
): string | undefined {
  return (
    transitions.find((t) => t.from === stepId)?.to
    ?? steps.find((s) => s.type === 'terminal')?.id
  );
}

/** Order-insensitive canonical serialization (object keys sorted recursively). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Whether a pasted workflow document changed any field other than the graph —
 * `steps`, `transitions` and the `inputForNextRun` entries that name their step
 * ids — relative to the canvas's current non-graph fields. The canvas JSON
 * editor applies the graph only, so this gates whether to refuse the apply.
 * Order-insensitive, so merely reordering keys in the JSON is not treated as a
 * change.
 */
export function nonGraphFieldsDiffer(
  doc: Record<string, unknown>,
  wdJsonFields: Record<string, unknown> | undefined,
): boolean {
  const { steps: _steps, transitions: _transitions, inputForNextRun: _inputForNextRun, ...rest } = doc;
  return stableStringify(rest) !== stableStringify(wdJsonFields ?? {});
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
    (s) =>
      s.type !== 'terminal' &&
      !resultTransitions.some((t) => t.from === s.id) &&
      !Object.values(s.verdicts ?? {}).some((v) => v.target),
  );

  if (orphans.length > 0) {
    resultTransitions = [
      ...resultTransitions,
      ...orphans.map((s) => ({ from: s.id, to: terminalId })),
    ];
  }

  return { steps: resultSteps, transitions: resultTransitions };
}

/**
 * Points carry-over entries (`inputForNextRun`) at a step that was renamed,
 * the same way a rename rewires transitions and verdict targets. Without this
 * the entry keeps the old id, the server's cross-field check rejects the save
 * (`stepId '…' does not match any step id`), and the only way to correct it is
 * to retype the block in the source-code panel.
 *
 * Returns the original reference when no entry named the renamed step.
 */
export function retargetCarryOver(
  entries: CarryOverEntries | undefined,
  oldId: string,
  newId: string,
): CarryOverEntries | undefined {
  if (!entries?.some((entry) => entry.stepId === oldId)) return entries;
  return entries.map((entry) => (entry.stepId === oldId ? { ...entry, stepId: newId } : entry));
}

/**
 * Drops carry-over entries whose step is gone — deleted from the diagram,
 * removed by the assistant, or absent from an applied JSON document. There is
 * nothing left to read the output from, and keeping the entry would make the
 * version unsavable.
 *
 * Returns the original reference when every entry still resolves.
 */
export function pruneCarryOver(
  entries: CarryOverEntries | undefined,
  steps: WorkflowStep[],
): CarryOverEntries | undefined {
  if (entries === undefined) return entries;
  const stepIds = new Set(steps.map((s) => s.id));
  const kept = entries.filter((entry) => stepIds.has(entry.stepId));
  return kept.length === entries.length ? entries : kept;
}
