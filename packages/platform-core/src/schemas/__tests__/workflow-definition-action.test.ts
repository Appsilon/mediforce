import { describe, expect, it } from 'vitest';
import {
  WorkflowDefinitionSchema,
  parseWorkflowDefinitionForCreation,
  parseWorkflowTemplate,
} from '../workflow-definition';

const baseTemplate = {
  name: 'execution-summaries-api',
  title: 'Execution Summaries API',
  description: 'Echo webhook payload through HTTP',
  triggers: [
    {
      type: 'webhook',
      name: 'main',
      config: { method: 'POST', path: '/execution-summaries' },
    },
  ],
  steps: [
    {
      id: 'echo',
      name: 'echo',
      type: 'terminal',
      executor: 'action',
      action: {
        kind: 'http',
        config: {
          method: 'POST',
          url: 'http://localhost:9099/anything',
          body: '${triggerPayload.body}',
        },
      },
    },
  ],
  transitions: [],
};

describe('workflow-definition action executor', () => {
  it('parses a workflow with executor:action and http config', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
    });
    expect(result.success).toBe(true);
  });

  it('rejects executor:action without action config', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'echo',
          name: 'echo',
          type: 'terminal',
          executor: 'action',
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('no action config');
    }
  });

  it('rejects action config on non-action executor', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'echo',
          name: 'echo',
          type: 'terminal',
          executor: 'human',
          action: { kind: 'http', config: { method: 'GET', url: 'http://x' } },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown action kind', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'echo',
          name: 'echo',
          type: 'terminal',
          executor: 'action',
          action: { kind: 'noop', config: {} },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects webhook trigger without method+path config', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      triggers: [{ type: 'webhook', name: 'main', config: {} }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects webhook trigger with bad path (missing leading /)', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      triggers: [
        {
          type: 'webhook',
          name: 'main',
          config: { method: 'POST', path: 'execution-summaries' },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('parses templates without namespace via parseWorkflowTemplate', () => {
    const result = parseWorkflowTemplate(baseTemplate);
    expect(result.success).toBe(true);
  });

  it('rejects templates that include namespace', () => {
    const result = parseWorkflowTemplate({
      ...baseTemplate,
      namespace: 'examples',
    });
    // Silently stripping `namespace` would let the author believe their value
    // is honored. Templates must omit `namespace` and let the loader inject it.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['namespace']);
    }
  });

  it('full WorkflowDefinitionSchema with namespace + version parses', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      ...baseTemplate,
      namespace: 'examples',
      version: 1,
    });
    expect(result.success).toBe(true);
  });

  it('parses a workflow with executor:action and reshape config', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'shape',
          name: 'shape',
          type: 'terminal',
          executor: 'action',
          action: {
            kind: 'reshape',
            config: {
              values: {
                id: '${triggerPayload.body.id}',
                source: 'webhook',
                count: 1,
              },
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects reshape with non-record values', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'shape',
          name: 'shape',
          type: 'terminal',
          executor: 'action',
          action: {
            kind: 'reshape',
            config: { values: 'not-an-object' },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects reshape without a values field', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'shape',
          name: 'shape',
          type: 'terminal',
          executor: 'action',
          action: {
            kind: 'reshape',
            config: {},
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('parses wait action with duration', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'pause',
          name: 'Wait 2 hours',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'wait',
            config: { duration: { hours: 2 } },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses wait action with deadline', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'pause',
          name: 'Wait until deadline',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'wait',
            config: { deadline: '${triggerPayload.collectUntil}' },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses wait action with deadline and condition', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'pause',
          name: 'Wait for children',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'wait',
            config: {
              deadline: '${triggerPayload.collectUntil}',
              condition: 'variables.spawn_step.allCompleted == true',
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects wait with both duration and deadline', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'pause',
          name: 'Bad wait',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'wait',
            config: { duration: { hours: 1 }, deadline: '2026-06-01T00:00:00Z' },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('exactly one of duration or deadline');
    }
  });

  it('rejects wait with neither duration nor deadline', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'pause',
          name: 'Bad wait',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'wait',
            config: {},
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('exactly one of duration or deadline');
    }
  });

  it('rejects wait with zero duration', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'examples',
      steps: [
        {
          id: 'pause',
          name: 'Bad wait',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'wait',
            config: { duration: { seconds: 0 } },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('duration must be greater than zero');
    }
  });
});
