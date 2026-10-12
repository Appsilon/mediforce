import type {
  ProcessInstanceRepository,
  AgentOutputEnvelope,
  AgentFallbackReason,
} from '@mediforce/platform-core';
import type { AgentRunResult } from './agent-runner';

export class FallbackHandler {
  constructor(
    private readonly instanceRepository: ProcessInstanceRepository,
  ) {}

  /** Every fallback escalates to a person: the instance pauses until one acts. */
  async escalate(
    reason: AgentFallbackReason,
    processInstanceId: string,
    originalEnvelope?: AgentOutputEnvelope | null,
  ): Promise<AgentRunResult> {
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
