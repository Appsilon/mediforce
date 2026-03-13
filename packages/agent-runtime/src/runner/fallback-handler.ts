import type {
  ProcessInstanceRepository,
  StepConfig,
  AgentEvent,
  AgentOutputEnvelope,
} from '@mediforce/platform-core';
import type { AgentContext } from '../interfaces/agent-plugin.js';
import type { AgentRunResult } from './agent-runner.js';

export class FallbackHandler {
  constructor(
    private readonly instanceRepository: ProcessInstanceRepository,
  ) {}

  async handle(
    reason: 'timeout' | 'low_confidence' | 'error',
    context: AgentContext,
    stepConfig: StepConfig,
    partialWork: AgentEvent[],
    originalEnvelope?: AgentOutputEnvelope | null,
  ): Promise<AgentRunResult> {
    const behavior = stepConfig.fallbackBehavior ?? 'escalate_to_human';

    switch (behavior) {
      case 'escalate_to_human': {
        await this.instanceRepository.update(context.processInstanceId, {
          status: 'paused',
          pauseReason: 'agent_escalated',
        });
        return {
          status: 'escalated',
          envelope: originalEnvelope ?? null,
          appliedToWorkflow: false,
          fallbackReason: reason,
        };
      }

      case 'continue_with_flag': {
        // No instance update — workflow continues
        return {
          status: 'flagged',
          envelope: originalEnvelope ?? null,
          appliedToWorkflow: false,
          fallbackReason: reason,
        };
      }

      case 'pause': {
        await this.instanceRepository.update(context.processInstanceId, {
          status: 'paused',
          pauseReason: 'agent_paused',
        });
        return {
          status: 'paused',
          envelope: originalEnvelope ?? null,
          appliedToWorkflow: false,
          fallbackReason: reason,
        };
      }

      default: {
        // Should never happen given StepConfig type — escalate as safe default
        await this.instanceRepository.update(context.processInstanceId, {
          status: 'paused',
          pauseReason: 'agent_escalated',
        });
        return {
          status: 'escalated',
          envelope: originalEnvelope ?? null,
          appliedToWorkflow: false,
          fallbackReason: reason,
        };
      }
    }
  }
}
