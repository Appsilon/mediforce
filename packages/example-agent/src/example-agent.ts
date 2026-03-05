import type { AgentPlugin, AgentContext, EmitFn } from '@mediforce/agent-runtime';

/**
 * ExampleAgent: Reference implementation of AgentPlugin.
 *
 * Plugin pattern:
 * 1. initialize(): receive and store context (step input, config, LLM client)
 * 2. run(emit): do work, emit events as you go
 *    - 'status' events: progress updates ("analyzing file 3/50")
 *    - 'annotation' events: findings discovered during execution
 *    - 'result' event: final output in AgentOutputEnvelope format (REQUIRED to complete)
 *
 * Autonomy behavior is applied by AgentRunner AFTER run() completes.
 * Plugins are autonomy-agnostic — never check context.autonomyLevel.
 */
export class ExampleAgent implements AgentPlugin {
  private context!: AgentContext;

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;
  }

  async run(emit: EmitFn): Promise<void> {
    // Signal what we're doing
    await emit({ type: 'status', payload: 'analyzing input data', timestamp: new Date().toISOString() });

    // Emit a finding discovered during execution
    await emit({
      type: 'annotation',
      payload: { content: 'Example finding: input data appears well-formed' },
      timestamp: new Date().toISOString(),
    });

    // Emit final result — payload MUST conform to AgentOutputEnvelopeSchema
    await emit({
      type: 'result',
      payload: {
        confidence: 0.9,
        reasoning_summary: 'Example analysis complete — all checks passed',
        reasoning_chain: ['Checked input format', 'Validated field types', 'Confirmed completeness'],
        annotations: [],
        model: null, // non-LLM agent
        duration_ms: 50,
        result: { outcome: 'pass', finding: 'example analysis complete' },
      },
      timestamp: new Date().toISOString(),
    });
  }
}
