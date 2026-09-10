import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowDefinition } from '../workflow-definition';
import { applyWorkflowAssistantToolCalls } from '../workflow-assistant-apply';
import { UpdateWorkflowToolSchema } from '../workflow-assistant-tools';
import type { WorkflowAssistantToolCall } from '../workflow-assistant-tools';

type Transitions = WorkflowDefinition['transitions'];

function baseCanvas(): { steps: WorkflowStep[]; transitions: Transitions } {
  return {
    steps: [
      { id: 'draft', name: 'Draft', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'draft', to: 'done' }],
  };
}

describe('applyWorkflowAssistantToolCalls', () => {
  it('defaults an agent step to L3 (matching the assistant prompt), not L2', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'agent', name: 'AI Draft' } },
    ];
    const { steps } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const added = steps.find((s) => s.id === 'ai-draft');
    expect(added?.autonomyLevel).toBe('L3');
  });

  it('passes ui / assignedTo / continueOnError through to the created step (parity with hand-editing)', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: {
        type: 'creation', executor: 'human', name: 'Upload Dataframe',
        ui: { component: 'file-upload', config: { minFiles: 1, maxFiles: 1 } },
        assignedTo: '${triggerPayload.userId}',
        continueOnError: true,
      } },
    ];
    const { steps } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const added = steps.find((s) => s.id === 'upload-dataframe');
    expect(added?.ui).toEqual({ component: 'file-upload', config: { minFiles: 1, maxFiles: 1 } });
    expect(added?.assignedTo).toBe('${triggerPayload.userId}');
    expect(added?.continueOnError).toBe(true);
  });

  it('assigns a new step the slugified id of its name, not its clientId', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'action', name: 'Send Results Email', clientId: 'email' } },
    ];
    const { steps, addedStepIds } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(addedStepIds).toEqual(['send-results-email']);
    expect(steps.some((s) => s.id === 'send-results-email')).toBe(true);
    expect(steps.some((s) => s.id === 'email')).toBe(false);
  });

  it('falls back to a generated id when the step name has no slug characters', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: '!!!' } },
    ];
    const { steps, addedStepIds } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(addedStepIds).toEqual(['new-step-1']);
    expect(steps.some((step) => step.id === 'new-step-1')).toBe(true);
  });

  it('inserts a step with no explicit insertion point before the terminal and wires it in — never leaves it disconnected', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Approve' } },
    ];
    const { transitions } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(transitions).toEqual(expect.arrayContaining([
      { from: 'draft', to: 'approve' },
      { from: 'approve', to: 'done' },
    ]));
    expect(transitions.some((t) => t.from === 'draft' && t.to === 'done')).toBe(false);
  });

  it('applies an update to a step ADDED EARLIER in the same batch — the exact stale-state bug that left steps missing', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Approve Email', clientId: 'approve' } },
      { tool: 'update_step', arguments: { stepId: 'approve', description: 'Review and approve.' } },
    ];
    const { steps, outcomes } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(outcomes.every((o) => !o.error)).toBe(true);
    expect(steps.find((s) => s.id === 'approve-email')?.description).toBe('Review and approve.');
  });

  it('resolves a verdict target that references an earlier-added step by clientId to that step\'s real id', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'action', name: 'Send Email', clientId: 'email', action: { kind: 'email', config: { to: 'a@b.com', subject: 's', body: 'b' } }, insertAfterId: 'draft', insertBeforeId: 'done' } },
      { tool: 'update_step', arguments: { stepId: 'draft', type: 'decision', verdicts: { approve: { target: 'email' }, reject: { target: 'done' } } } },
    ];
    const { steps } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const draft = steps.find((s) => s.id === 'draft');
    expect(draft?.verdicts?.approve.target).toBe('send-email');
    expect(draft?.verdicts?.reject.target).toBe('done');
  });

  it('reports an outcome error (and does not throw) when updating a step removed earlier in the same batch', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'remove_step', arguments: { stepId: 'draft' } },
      { tool: 'update_step', arguments: { stepId: 'draft', description: 'x' } },
    ];
    const { outcomes } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const updateOutcome = outcomes.find((o) => o.tool === 'update_step');
    expect(updateOutcome?.error).toMatch(/doesn't exist/);
  });
});

// The assistant could only ever reach step-level fields: its three tools are
// all step-scoped and the reducer took only (steps, transitions). Everything at
// the workflow level — the input contract, the agent preamble, env — was
// unreachable by prompt no matter how the request was phrased.
describe('applyWorkflowAssistantToolCalls — the workflow level', () => {
  it('sets the input contract the whole workflow validates against', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'update_workflow', arguments: {
        triggerInput: [{ name: 'studyId', type: 'string', required: true }],
      } },
    ];
    const { settings } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(settings.triggerInput).toEqual([{ name: 'studyId', type: 'string', required: true }]);
  });

  it('patches rather than replaces, so setting one field keeps the rest', () => {
    const { settings } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { preamble: 'House rules.' } }],
      { env: { STUDY_ID: 'CDISCPILOT01' } },
    );
    expect(settings.preamble).toBe('House rules.');
    expect(settings.env).toEqual({ STUDY_ID: 'CDISCPILOT01' });
  });

  it('cannot touch visibility, which has its own control', () => {
    // Its editor on the workflow page PATCHes every version at once; a register
    // writes only the new one, so two controls would disagree.
    expect('visibility' in UpdateWorkflowToolSchema.shape).toBe(false);
  });

  it('merges env and metadata rather than replacing them', () => {
    // "add STUDY_ID to env" must not drop the other variables, and setting a
    // metadata key must not wipe the display name.
    const { settings } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { env: { STUDY_ID: 'X' }, metadata: { category: 'safety' } } }],
      { env: { LAKE_PATH: '/output/lake' }, metadata: { displayName: 'Landing Zone' } },
    );
    expect(settings.env).toEqual({ LAKE_PATH: '/output/lake', STUDY_ID: 'X' });
    expect(settings.metadata).toEqual({ displayName: 'Landing Zone', category: 'safety' });
  });

  it('reports which fields it changed, so the pane can summarise the edit', () => {
    const { outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { preamble: 'x', url: 'https://example.com' } }],
    );
    const outcome = outcomes.find((o) => o.tool === 'update_workflow');
    expect(outcome?.error).toBeUndefined();
    expect(outcome?.stepId).toContain('preamble');
  });
});

describe('applyWorkflowAssistantToolCalls — transition conditions', () => {
  it('sets a when expression on an existing edge', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'done', when: 'output.ready == true' } },
    ];
    const { transitions } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(transitions).toEqual([{ from: 'draft', to: 'done', when: 'output.ready == true' }]);
  });

  it('clears the condition when given no expression', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'done' } },
    ];
    const { transitions } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      [{ from: 'draft', to: 'done', when: 'output.ready == true' }],
      calls,
    );
    expect(transitions).toEqual([{ from: 'draft', to: 'done' }]);
  });

  it('refuses an edge that does not exist rather than inventing one', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'nowhere', when: 'x == 1' } },
    ];
    const { transitions, outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(transitions).toEqual(baseCanvas().transitions);
    expect(outcomes.find((o) => o.tool === 'set_transition_condition')?.error).toContain('nowhere');
  });
});
