import { describe, it, expect } from 'vitest';
import {
  AddStepToolSchema,
  UpdateStepToolSchema,
  RemoveStepToolSchema,
  ListModelsToolSchema,
  WORKFLOW_ASSISTANT_TOOLS,
} from '../workflow-assistant-tools';

describe('AddStepToolSchema', () => {
  it('parses a minimal step', () => {
    const result = AddStepToolSchema.safeParse({ type: 'creation', executor: 'human', name: 'Draft' });
    expect(result.success).toBe(true);
  });

  it('parses a full agent step, including real WorkflowAgentConfig fields and insertion points', () => {
    const result = AddStepToolSchema.safeParse({
      type: 'decision',
      executor: 'agent',
      name: 'Clinical Review',
      autonomyLevel: 'L2',
      agentId: 'clinical-reviewer',
      agent: { prompt: 'Review for accuracy.', model: 'anthropic/claude-sonnet-4' },
      insertAfterId: 'draft',
      insertBeforeId: 'done',
    });
    expect(result.success).toBe(true);
  });

  it('parses any of the real action kinds, not just email', () => {
    for (const action of [
      { kind: 'email', config: { to: 'a@b.com', subject: 's', body: 'b' } },
      { kind: 'http', config: { method: 'POST', url: 'https://example.com' } },
      { kind: 'wait', config: { duration: { minutes: 5 } } },
    ]) {
      const result = AddStepToolSchema.safeParse({ type: 'creation', executor: 'action', name: 'Notify', action });
      expect(result.success, `expected ${action.kind} to parse`).toBe(true);
    }
  });

  it('rejects a step with no name — every step must be identifiable, not the canvas placeholder', () => {
    const result = AddStepToolSchema.safeParse({ type: 'creation', executor: 'human' });
    expect(result.success).toBe(false);
  });

  it('coerces a bare-string action into a specific "config required" error instead of a vague "expected object"', () => {
    const result = AddStepToolSchema.safeParse({ type: 'creation', executor: 'action', name: 'Notify', action: 'email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['action', 'config']);
    }
  });

  it('normalizes case/separator variants and common synonyms of an action kind, not just the exact literal', () => {
    const validConfig = { to: 'a@b.com', subject: 's', body: 'b' };
    for (const kind of ['Email', 'EMAIL', 'send_email', 'sendEmail', 'notify', 'mail']) {
      const result = AddStepToolSchema.safeParse({
        type: 'creation', executor: 'action', name: 'Notify', action: { kind, config: validConfig },
      });
      expect(result.success, `expected "${kind}" to normalize to email`).toBe(true);
      if (result.success) expect(result.data.action?.kind).toBe('email');
    }
  });

  it('parses a double-encoded JSON string for action, not just a real nested object', () => {
    const result = AddStepToolSchema.safeParse({
      type: 'creation', executor: 'action', name: 'Notify',
      action: JSON.stringify({ kind: 'email', config: { to: 'a@b.com', subject: 's', body: 'b' } }),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action?.kind).toBe('email');
  });

  it('parses a double-encoded JSON string for agent, not just a real nested object', () => {
    const result = AddStepToolSchema.safeParse({
      type: 'creation', executor: 'agent', name: 'Review',
      agent: JSON.stringify({ prompt: 'Review the draft.' }),
    });
    expect(result.success).toBe(true);
  });

  it('treats action.type as an alias for action.kind — the step itself already has a sibling `type` field', () => {
    const result = AddStepToolSchema.safeParse({
      type: 'creation', executor: 'action', name: 'Notify',
      action: { type: 'email', config: { to: 'a@b.com', subject: 's', body: 'b' } },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action?.kind).toBe('email');
  });

  it('still rejects a kind with no known mapping', () => {
    const result = AddStepToolSchema.safeParse({
      type: 'creation', executor: 'action', name: 'X', action: { kind: 'launch_missiles', config: {} },
    });
    expect(result.success).toBe(false);
  });

  it('rejects verdicts on a non-decision type — review is deprecated, the assistant must use decision', () => {
    const result = AddStepToolSchema.safeParse({
      type: 'review', executor: 'human', name: 'Approve Email',
      verdicts: { approve: { target: 'send-email' }, reject: { target: 'done' } },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['type']);
  });

  it('accepts verdicts when type is decision', () => {
    const result = AddStepToolSchema.safeParse({
      type: 'decision', executor: 'human', name: 'Approve Email',
      verdicts: { approve: { target: 'send-email' }, reject: { target: 'done' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects verdicts on a non-decision type in update_step too, when both are set in the same patch', () => {
    const result = UpdateStepToolSchema.safeParse({
      stepId: 'approve-email', type: 'review',
      verdicts: { approve: { target: 'send-email' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects the terminal type — the canvas manages the one terminal step itself', () => {
    const result = AddStepToolSchema.safeParse({ type: 'terminal', executor: 'human', name: 'Done' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown executor', () => {
    const result = AddStepToolSchema.safeParse({ type: 'creation', executor: 'robot', name: 'X' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown autonomy level', () => {
    const result = AddStepToolSchema.safeParse({ type: 'creation', executor: 'agent', name: 'X', autonomyLevel: 'L5' });
    expect(result.success).toBe(false);
  });

  it('parses an optional clientId for chaining new steps together', () => {
    const result = AddStepToolSchema.safeParse({ type: 'creation', executor: 'agent', name: 'X', clientId: 'generate' });
    expect(result.success).toBe(true);
  });

  it('omits fields not exposed anywhere in the human-facing step editor', () => {
    const shape = AddStepToolSchema.shape;
    for (const field of ['plugin', 'metadata', 'stepParams', 'assignedTo', 'continueOnError', 'ui'] as const) {
      expect(field in shape).toBe(false);
    }
  });
});

describe('UpdateStepToolSchema', () => {
  it('parses a stepId-only patch', () => {
    expect(UpdateStepToolSchema.safeParse({ stepId: 'draft' }).success).toBe(true);
  });

  it('parses a partial patch touching any real WorkflowStep field, e.g. agent config', () => {
    const result = UpdateStepToolSchema.safeParse({
      stepId: 'draft',
      name: 'Draft the report',
      description: 'Writes the first pass',
      agent: { prompt: 'Summarize the findings.', model: 'anthropic/claude-sonnet-4' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing stepId', () => {
    expect(UpdateStepToolSchema.safeParse({ name: 'Draft' }).success).toBe(false);
  });

  it('rejects an empty stepId', () => {
    expect(UpdateStepToolSchema.safeParse({ stepId: '' }).success).toBe(false);
  });

  it('accepts insertAfterId/insertBeforeId — the only way to (re)connect an already-existing step', () => {
    const result = UpdateStepToolSchema.safeParse({
      stepId: 'orphaned-step',
      insertAfterId: 'draft',
      insertBeforeId: 'done',
    });
    expect(result.success).toBe(true);
  });
});

describe('RemoveStepToolSchema', () => {
  it('parses a valid stepId', () => {
    expect(RemoveStepToolSchema.safeParse({ stepId: 'draft' }).success).toBe(true);
  });

  it('rejects a missing stepId', () => {
    expect(RemoveStepToolSchema.safeParse({}).success).toBe(false);
  });
});

describe('WORKFLOW_ASSISTANT_TOOLS', () => {
  it('exposes exactly the three canvas-mutation tools', () => {
    expect(Object.keys(WORKFLOW_ASSISTANT_TOOLS).sort()).toEqual(['add_step', 'remove_step', 'update_step']);
  });
});

describe('ListModelsToolSchema', () => {
  it('parses with no arguments', () => {
    expect(ListModelsToolSchema.safeParse({}).success).toBe(true);
  });

  it('parses an optional preference hint', () => {
    expect(ListModelsToolSchema.safeParse({ preference: 'cheap' }).success).toBe(true);
  });
});
