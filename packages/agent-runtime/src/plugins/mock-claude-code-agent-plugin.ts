import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { AgentContext, StepExecutorPlugin, EmitFn, WorkflowAgentContext } from '../interfaces/step-executor-plugin';
import { ClaudeCodeAgentPlugin } from './claude-code-agent-plugin';

export class MockClaudeCodeAgentPlugin implements StepExecutorPlugin {
  // The mock emits a deterministic result without spawning a container, so it
  // has none of the real plugin's implicit env requirements. Drop requiredEnv
  // so the run preflight does not block MOCK_AGENT runs (e2e, local dev) that
  // legitimately lack ANTHROPIC_API_KEY / OPENROUTER_API_KEY.
  readonly metadata: PluginCapabilityMetadata = {
    ...new ClaudeCodeAgentPlugin().metadata,
    requiredEnv: undefined,
  };

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
