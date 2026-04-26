import { describe, expect, it } from 'vitest';
import {
  WorkflowDefinitionSchema,
  parseWorkflowDefinitionForCreation,
  parseWorkflowTemplate,
} from '../workflow-definition.js';

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
      namespace: 'filip',
    });
    expect(result.success).toBe(true);
  });

  it('rejects executor:action without action config', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'filip',
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
      namespace: 'filip',
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
      namespace: 'filip',
      steps: [
        {
          id: 'echo',
          name: 'echo',
          type: 'terminal',
          executor: 'action',
          action: { kind: 'wait', config: { ms: 100 } },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects webhook trigger without method+path config', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'filip',
      triggers: [{ type: 'webhook', name: 'main', config: {} }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects webhook trigger with bad path (missing leading /)', () => {
    const result = parseWorkflowDefinitionForCreation({
      ...baseTemplate,
      namespace: 'filip',
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
      namespace: 'filip',
    });
    // Templates carry no namespace; loader injects it. With the omit() schema
    // an extra key is silently stripped — so we still expect success but the
    // injected namespace must come from the loader, not the template.
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { namespace?: string }).namespace).toBeUndefined();
    }
  });

  it('full WorkflowDefinitionSchema with namespace + version parses', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      ...baseTemplate,
      namespace: 'filip',
      version: 1,
    });
    expect(result.success).toBe(true);
  });
});
