import { describe, it, expect } from 'vitest';
import { parseMutationToolCall } from '../ask-workflow-assistant';
import { WORKFLOW_ASSISTANT_TOOLS } from '@mediforce/platform-core';

describe('parseMutationToolCall', () => {
  it('accepts a well-formed add_step call', () => {
    const parsed = parseMutationToolCall('add_step', { type: 'creation', executor: 'human', name: 'Intake' });
    expect(parsed.ok).toBe(true);
  });

  it('rejects a terminal add_step with an actionable hint, not just the raw enum error', () => {
    const parsed = parseMutationToolCall('add_step', { type: 'terminal', executor: 'human', name: 'Done' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected rejection');
    expect(parsed.error).toMatch(/terminal steps are not added or edited/i);
    expect(parsed.error).toMatch(/existing terminal step's id/i);
  });

  it('rejects retargeting an existing step to terminal via update_step with the same hint', () => {
    const parsed = parseMutationToolCall('update_step', { stepId: 'review', type: 'terminal' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected rejection');
    expect(parsed.error).toMatch(/terminal steps are not added or edited/i);
  });

  // The parser used to be a hardcoded ladder while `buildToolDefinitions`
  // advertised the whole registry, so a tool could be offered to the model and
  // then rejected on arrival — and the completeness gate discarded any step
  // edits batched alongside it.
  it('accepts every tool the model is offered', () => {
    for (const name of Object.keys(WORKFLOW_ASSISTANT_TOOLS)) {
      const parsed = parseMutationToolCall(name, {});
      // Arguments may be invalid for an empty object, but the tool name itself
      // must never come back unknown.
      if (parsed.ok === false) expect(parsed.error).not.toMatch(/unknown tool/i);
    }
  });

  it('accepts a well-formed update_workflow call', () => {
    const parsed = parseMutationToolCall('update_workflow', {
      triggerInput: [{ name: 'studyId', type: 'string', required: true }],
    });
    expect(parsed.ok).toBe(true);
  });

  it('accepts a well-formed set_transition_condition call', () => {
    const parsed = parseMutationToolCall('set_transition_condition', {
      from: 'draft', to: 'done', when: 'output.ready == true',
    });
    expect(parsed.ok).toBe(true);
  });

  it('names every valid tool when the name is genuinely unknown', () => {
    const parsed = parseMutationToolCall('rename_workflow', {});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected rejection');
    expect(parsed.error).toMatch(/update_workflow/);
    expect(parsed.error).toMatch(/set_transition_condition/);
  });
});
