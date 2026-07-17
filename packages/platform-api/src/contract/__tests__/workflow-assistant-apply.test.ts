import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowDefinition } from '@mediforce/platform-core';
import { applyWorkflowAssistantToolCalls } from '../workflow-assistant-apply';
import type { WorkflowAssistantToolCall } from '../workflow-assistant';

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
  it('assigns a new step the slugified id of its name, not its clientId', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'action', name: 'Send Results Email', clientId: 'email' } },
    ];
    const { steps, addedStepIds } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(addedStepIds).toEqual(['send-results-email']);
    expect(steps.some((s) => s.id === 'send-results-email')).toBe(true);
    expect(steps.some((s) => s.id === 'email')).toBe(false);
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
