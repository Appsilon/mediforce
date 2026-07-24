import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { AgentContext, StepExecutorPlugin, EmitFn, WorkflowAgentContext } from '../interfaces/step-executor-plugin';

/**
 * A deterministic mock agent plugin that emits canned output without spawning a
 * container. Used by two callers, both of which want to exercise a workflow's
 * structure without paying for (or waiting on) real agent execution:
 *
 *   - `MOCK_AGENT=true` (dev / e2e) — swapped in for `claude-code-agent`.
 *   - Per-run dry runs (`instance.dryRun`) — swapped in for ANY agent/script
 *     plugin id, so a dry run mocks every agent type, not just Claude.
 *
 * The output is generic over `stepId` and carries no agent-type-specific shape,
 * so it stands in for `opencode-agent`, `script-container`, `databricks-job`,
 * etc. equally.
 */
export class MockAgentPlugin implements StepExecutorPlugin {
  // No container spawn means none of the real plugins' implicit env
  // requirements apply, so `requiredEnv` is dropped and the run preflight does
  // not block mock runs that legitimately lack ANTHROPIC_API_KEY / OPENROUTER_API_KEY.
  readonly metadata: PluginCapabilityMetadata = {
    name: 'mock-agent',
    description: 'Deterministic mock agent — emits canned output without spawning a container.',
    inputDescription: 'Any step input (ignored).',
    outputDescription: 'A deterministic mock result envelope.',
    roles: ['executor', 'reviewer'],
    foundationModel: 'mock-agent',
  };

  private context: AgentContext | WorkflowAgentContext | null = null;

  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    this.context = context;
  }

  async run(emit: EmitFn): Promise<void> {
    if (!this.context) {
      throw new Error('MockAgentPlugin must be initialized before run().');
    }

    // Optional artificial delay before emitting the result. Lets local dev hold
    // a step `running` long enough to exercise mid-step recovery paths (e.g. the
    // ADR-0010 §4 SIGTERM deploy interrupt) without needing a real slow agent.
    const delayMs = Number(process.env.MOCK_AGENT_DELAY_MS);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await emit({
      type: 'result',
      payload: {
        confidence: 1,
        confidence_rationale: 'Mock agent generated deterministic output.',
        reasoning_summary: `Mock agent completed step '${this.context.stepId}'.`,
        reasoning_chain: [
          'Mock agent',
          `Step: ${this.context.stepId}`,
        ],
        annotations: [],
        model: 'mock-agent',
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
