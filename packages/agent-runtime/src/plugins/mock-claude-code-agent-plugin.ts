import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { AgentContext, AgentPlugin, EmitFn, WorkflowAgentContext } from '../interfaces/agent-plugin';
import { ClaudeCodeAgentPlugin } from './claude-code-agent-plugin';

export class MockClaudeCodeAgentPlugin implements AgentPlugin {
  readonly metadata: PluginCapabilityMetadata = new ClaudeCodeAgentPlugin().metadata;

  private context: AgentContext | WorkflowAgentContext | null = null;

  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    this.context = context;
  }

  async run(emit: EmitFn): Promise<void> {
    if (!this.context) {
      throw new Error('MockClaudeCodeAgentPlugin must be initialized before run().');
    }

    await emit({
      type: 'result',
      payload: {
        confidence: 1,
        confidence_rationale: 'MOCK_AGENT=true generated deterministic output.',
        reasoning_summary: `Mock agent completed step '${this.context.stepId}'.`,
        reasoning_chain: [
          'MOCK_AGENT=true',
          `Step: ${this.context.stepId}`,
        ],
        annotations: [],
        model: 'mock-claude-code-agent',
        duration_ms: 0,
        result: {
          mock: true,
          summary: `Mock output for step ${this.context.stepId}`,
        },
      },
      timestamp: new Date().toISOString(),
    });
  }
}
