import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowDefinition } from '@mediforce/platform-core';
import type { WorkflowAssistantToolCall } from '../../../contract/workflow-assistant';
import { validateResultingGraph } from '../ask-workflow-assistant';

// A minimal valid two-step graph the assistant edits.
const baseSteps: WorkflowStep[] = [
  { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
  { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
];
const baseTransitions: WorkflowDefinition['transitions'] = [{ from: 'start', to: 'done' }];
const base = { steps: baseSteps, transitions: baseTransitions };

describe('validateResultingGraph', () => {
  it('accepts a valid mutation', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Review', insertAfterId: 'start', insertBeforeId: 'done' } },
    ];
    // The applied graph comes back with the verdict: the loop needs the real
    // ids to tell the model what to reconnect.
    const result = validateResultingGraph(base, calls, 'team-alpha');
    expect(result.valid).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual(['start', 'review', 'done']);
    expect(result.transitions).toEqual([{ from: 'start', to: 'review' }, { from: 'review', to: 'done' }]);
  });

  // #2 — a reducer-rejected call must fail the gate even though the *unchanged*
  // graph is still valid, so the UI never counts it as an applied mutation.
  it('rejects a remove_step on an unknown id (reducer outcome error)', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'remove_step', arguments: { stepId: 'ghost-step' } },
    ];
    const result = validateResultingGraph(base, calls, 'team-alpha');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(' ')).toMatch(/ghost-step|not found|unknown/i);
    }
  });

  // #1 — the canonical cross-field schema (wait needs exactly one of duration/
  // deadline) is enforced, not just graph/reference structure.
  it('rejects an action step that violates canonical cross-field rules', () => {
    const calls: WorkflowAssistantToolCall[] = [
      {
        tool: 'add_step',
        arguments: {
          type: 'creation',
          executor: 'action',
          name: 'Wait',
          action: { kind: 'wait', config: {} },
          insertAfterId: 'start',
          insertBeforeId: 'done',
        },
      },
    ];
    const result = validateResultingGraph(base, calls, 'team-alpha');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(' ')).toMatch(/duration|deadline|wait/i);
    }
  });

  // The guide promises the assistant's edits pass "the same schema gates as
  // registration". That was true of the graph and false of the workflow level,
  // so a bad url passed the gate and failed the whole save at register.
  it('rejects a workflow-level value the register schema would refuse', () => {
    const result = validateResultingGraph(
      {
        steps: [
          { id: 'draft', name: 'Draft', type: 'creation', executor: 'human' },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'draft', to: 'done' }],
      },
      [{ tool: 'update_workflow', arguments: { url: 'not-a-url' } }],
      'test',
    );
    expect(result.valid).toBe(false);
  });

  it('accepts a valid workflow-level edit', () => {
    const result = validateResultingGraph(
      {
        steps: [
          { id: 'draft', name: 'Draft', type: 'creation', executor: 'human' },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'draft', to: 'done' }],
      },
      [{ tool: 'update_workflow', arguments: { preamble: 'House rules.' } }],
      'test',
    );
    expect(result.valid).toBe(true);
  });
});
