import type {
  ProcessInstanceRepository,
  StepConfig,
  AgentEvent,
  AgentOutputEnvelope,
} from '@mediforce/platform-core';
import type { AgentContext, WorkflowAgentContext } from '../interfaces/agent-plugin.js';
import type { AgentRunResult } from './agent-runner.js';

export class FallbackHandler {
  constructor(
    private readonly instanceRepository: ProcessInstanceRepository,
  ) {}

  async handleWithWorkflowStep(
    reason: 'timeout' | 'low_confidence' | 'error',
    context: WorkflowAgentContext,
    partialWork: AgentEvent[],
    originalEnvelope?: AgentOutputEnvelope | null,
  ): Promise<AgentRunResult> {
    const behavior = context.step.agent?.fallbackBehavior ?? 'escalate_to_human';
    return this.applyFallbackBehavior(behavior, reason, context.processInstanceId, originalEnvelope);
  }

  /**
   * @deprecated Use handleWithWorkflowStep instead. This method relies on the legacy StepConfig model.
   */
  async handle(
    reason: 'timeout' | 'low_confidence' | 'error',
    context: AgentContext,
    stepConfig: StepConfig,
    partialWork: AgentEvent[],
    originalEnvelope?: AgentOutputEnvelope | null,
  ): Promise<AgentRunResult> {
    const behavior = stepConfig.fallbackBehavior ?? 'escalate_to_human';
    return this.applyFallbackBehavior(behavior, reason, context.processInstanceId, originalEnvelope);
  }

  private async applyFallbackBehavior(
    behavior: string,
    reason: 'timeout' | 'low_confidence' | 'error',
    processInstanceId: string,
    originalEnvelope?: AgentOutputEnvelope | null,
  ): Promise<AgentRunResult> {
    switch (behavior) {
      case 'escalate_to_human': {
        await this.instanceRepository.update(processInstanceId, {
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
        return {
          status: 'flagged',
          envelope: originalEnvelope ?? null,
          appliedToWorkflow: false,
          fallbackReason: reason,
        };
      }

      case 'pause': {
        await this.instanceRepository.update(processInstanceId, {
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
        await this.instanceRepository.update(processInstanceId, {
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
