import { describe, it, expect } from 'vitest';
import { toProcessDefinition, mergeVerdictTransitions, ensureEntryStepFirst, validateStepReferences } from '../workflow-graph';
import type { WorkflowDefinition, WorkflowStep } from '../workflow-definition';

function step(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, name: id, type: 'creation', executor: 'human', ...overrides };
}

describe('toProcessDefinition', () => {
  it('carries only routing-relevant fields through, as a plain object usable by validateStepGraph', () => {
    const definition: WorkflowDefinition = {
      name: 'wf', version: 3, namespace: 'test', visibility: 'private',
      steps: [
        step('start'),
        step('decide', { type: 'decision', verdicts: { approve: { target: 'done' } } }),
        step('done', { type: 'terminal' }),
      ],
      transitions: [{ from: 'start', to: 'decide' }],
      triggers: [{ type: 'manual', name: 'start' }],
    };
    const result = toProcessDefinition(definition);
    expect(result.name).toBe('wf');
    expect(result.version).toBe('3');
    expect(result.transitions).toEqual(definition.transitions);
    expect(result.steps.find((s) => s.id === 'decide')?.verdicts).toEqual({ approve: { target: 'done' } });
  });
});

describe('mergeVerdictTransitions', () => {
  it('adds a transition for every verdict target on a decision or review step', () => {
    const steps = [
      step('decide', { type: 'decision', verdicts: { approve: { target: 'done' }, reject: { target: 'start' } } }),
    ];
    const result = mergeVerdictTransitions(steps, []);
    expect(result).toEqual(expect.arrayContaining([
      { from: 'decide', to: 'done' },
      { from: 'decide', to: 'start' },
    ]));
    expect(result).toHaveLength(2);
  });

  it('does not duplicate a transition that already exists explicitly', () => {
    const steps = [step('decide', { type: 'decision', verdicts: { approve: { target: 'done' } } })];
    const result = mergeVerdictTransitions(steps, [{ from: 'decide', to: 'done' }]);
    expect(result).toEqual([{ from: 'decide', to: 'done' }]);
  });

  it('ignores verdicts on any type other than decision/review', () => {
    const steps = [step('x', { type: 'creation', verdicts: { approve: { target: 'done' } } })];
    expect(mergeVerdictTransitions(steps, [])).toEqual([]);
  });
});

describe('ensureEntryStepFirst', () => {
  it('leaves the array unchanged when the entry step is already first', () => {
    const steps = [step('a'), step('b'), step('c')];
    const transitions = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    expect(ensureEntryStepFirst(steps, transitions)).toEqual(steps);
  });

  it('moves the entry step to index 0 when it was built or saved out of order — the exact bug the engine hits, since WorkflowEngine.startInstance uses steps[0] as the literal starting point', () => {
    const steps = [step('send-email'), step('approve'), step('submit-word-pair')];
    const transitions = [
      { from: 'submit-word-pair', to: 'approve' },
      { from: 'approve', to: 'send-email' },
    ];
    const result = ensureEntryStepFirst(steps, transitions);
    expect(result[0].id).toBe('submit-word-pair');
    expect(result.map((s) => s.id).sort()).toEqual(['approve', 'send-email', 'submit-word-pair']);
  });

  it('leaves the array unchanged when there is no single unambiguous entry step (0 or multiple candidates) — a different, pre-existing problem this function does not try to guess at', () => {
    const steps = [step('a'), step('b')];
    const cyclic = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }];
    expect(ensureEntryStepFirst(steps, cyclic)).toEqual(steps);

    expect(ensureEntryStepFirst(steps, [])).toEqual(steps);
  });
});

describe('validateStepReferences', () => {
  const emailStep = (body: string, id = 'send', afterId = 'intake'): { steps: WorkflowStep[]; transitions: WorkflowDefinition['transitions'] } => ({
    steps: [
      { id: 'intake', name: 'Intake', type: 'creation', executor: 'human', params: [{ name: 'words', type: 'string', required: true }] },
      { id: 'analyze', name: 'Analyze', type: 'creation', executor: 'agent' },
      { id, name: 'Send', type: 'creation', executor: 'action', action: { kind: 'email', config: { to: 'a@b.com', subject: 's', body } } },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'intake', to: 'analyze' }, { from: 'analyze', to: id }, { from: id, to: 'done' }],
  });

  it('errors on a reference to a step that does not exist', () => {
    const { steps, transitions } = emailStep('Hi ${steps.nope.value}');
    const issues = validateStepReferences(steps, transitions);
    expect(issues.some((i) => i.severity === 'error' && /no step "nope" exists/.test(i.message))).toBe(true);
  });

  it('errors on a human-step param that is not declared', () => {
    const { steps, transitions } = emailStep('Words: ${steps.intake.wrongkey}');
    const issues = validateStepReferences(steps, transitions);
    expect(issues.some((i) => i.severity === 'error' && /produces no "wrongkey"/.test(i.message))).toBe(true);
  });

  it('accepts a valid human-step param reference', () => {
    const { steps, transitions } = emailStep('Words: ${steps.intake.words}');
    expect(validateStepReferences(steps, transitions).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('warns (not errors) on a whole-object reference dropped into text', () => {
    const { steps, transitions } = emailStep('Analysis: ${steps.analyze}');
    const issues = validateStepReferences(steps, transitions);
    expect(issues.some((i) => i.severity === 'warning' && /renders as raw JSON/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('does not touch agent output sub-keys (undecidable) — a deep agent ref is allowed', () => {
    const { steps, transitions } = emailStep('Result: ${steps.analyze.result.evidence}');
    expect(validateStepReferences(steps, transitions).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('warns when a referenced step is not upstream', () => {
    const { steps, transitions } = emailStep('${steps.done.x}');
    const issues = validateStepReferences(steps, transitions);
    expect(issues.some((i) => i.severity === 'warning' && /not upstream/.test(i.message))).toBe(true);
  });
});
