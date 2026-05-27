import { describe, expect, it } from 'vitest';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { MockClaudeCodeAgentPlugin } from '../mock-claude-code-agent-plugin.js';
import type { EmitPayload, WorkflowAgentContext } from '../../interfaces/agent-plugin.js';

describe('MockClaudeCodeAgentPlugin', () => {
  it('[DATA] emits deterministic output without step.agent config', async () => {
    const plugin = new MockClaudeCodeAgentPlugin();
    const events: EmitPayload[] = [];
    const context = {
      stepId: 'verify-data-quality',
      processInstanceId: 'run-1',
      runNamespace: 'test',
      definitionVersion: '1',
      stepInput: {},
      autonomyLevel: 'L2',
      workflowDefinition: buildWorkflowDefinition({
        name: 'Data Quality Review',
        version: 1,
        namespace: 'test',
        steps: [],
        transitions: [],
      }),
      step: {
        id: 'verify-data-quality',
        name: 'Verify Data Quality',
        type: 'creation',
        executor: 'agent',
      },
      llm: {
        complete: async () => ({
          content: '',
          model: 'mock',
          usage: { promptTokens: 0, completionTokens: 0 },
        }),
      },
      getPreviousStepOutputs: async () => ({}),
    } satisfies WorkflowAgentContext;

    await plugin.initialize(context);
    await plugin.run(async (event) => {
      events.push(event);
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'result',
      payload: {
        confidence: 1,
        model: 'mock-claude-code-agent',
        result: {
          mock: true,
          summary: 'Mock output for step verify-data-quality',
        },
      },
    });
  });
});
