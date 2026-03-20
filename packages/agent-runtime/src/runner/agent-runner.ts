import {
  AgentOutputEnvelopeSchema,
  type AgentOutputEnvelope,
  type AgentRunStatus,
  type ProcessInstanceRepository,
  type AuditRepository,
  type StepConfig,
  type AgentRunRepository,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { randomUUID } from 'crypto';
import type { AgentPlugin, AgentContext, WorkflowAgentContext, EmitPayload } from '../interfaces/agent-plugin.js';
import type { AgentEventLog } from './agent-event-log.js';
import { FallbackHandler } from './fallback-handler.js';

export interface AgentRunResult {
  status: AgentRunStatus;
  envelope: AgentOutputEnvelope | null;
  appliedToWorkflow: boolean; // true only for L4; false for L0/L1/L2/L3 and fallbacks
  fallbackReason: 'timeout' | 'low_confidence' | 'error' | null;
  errorMessage?: string | null;
}

class AgentTimeoutError extends Error {
  override name = 'AgentTimeoutError';
  constructor() {
    super('Agent execution timed out');
  }
}

export class AgentRunner {
  private readonly fallbackHandler: FallbackHandler;

  constructor(
    private readonly instanceRepository: ProcessInstanceRepository,
    private readonly auditRepository: AuditRepository,
    private readonly eventLog: AgentEventLog,
    private readonly agentRunRepository?: AgentRunRepository,
  ) {
    this.fallbackHandler = new FallbackHandler(instanceRepository);
  }

  /**
   * Run an agent plugin using the unified WorkflowDefinition model.
   * Config is read from step.agent (model, timeoutMinutes, confidenceThreshold,
   * fallbackBehavior) and step.autonomyLevel / step.plugin.
   */
  async runWithWorkflowStep(
    plugin: AgentPlugin,
    context: WorkflowAgentContext,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const { processInstanceId, stepId, autonomyLevel } = context;
    const runId = randomUUID();
    const pluginId = context.step.plugin ?? context.stepId;

    if (this.agentRunRepository) {
      await this.agentRunRepository.create({
        id: runId,
        processInstanceId,
        stepId,
        pluginId,
        autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
        status: 'running',
        envelope: null,
        fallbackReason: null,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: null,
      });
    }

    const emit = async (event: EmitPayload): Promise<void> => {
      await this.eventLog.write(processInstanceId, stepId, event);
    };

    await plugin.initialize(context);

    const timeoutMs = (context.step.agent?.timeoutMinutes ?? 30) * 60_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new AgentTimeoutError()), timeoutMs);
    });

    let fallbackReason: 'timeout' | 'low_confidence' | 'error' | null = null;
    let caughtErrorMessage: string | null = null;

    try {
      await Promise.race([plugin.run(emit), timeoutPromise]);

      const events = this.eventLog.getEvents(processInstanceId, stepId);
      const resultEvent = [...events].reverse().find((e) => e.type === 'result');

      if (!resultEvent) {
        fallbackReason = 'error';
      } else {
        const parseResult = AgentOutputEnvelopeSchema.safeParse(resultEvent.payload);
        if (!parseResult.success) {
          fallbackReason = 'error';
        } else {
          const envelope = parseResult.data;

          const threshold = context.step.agent?.confidenceThreshold ?? 0;
          if (envelope.confidence < threshold) {
            fallbackReason = 'low_confidence';
          }

          if (fallbackReason) {
            const partialWork = this.eventLog.getPartialWork(processInstanceId, stepId);
            const fallbackResult = await this.fallbackHandler.handleWithWorkflowStep(
              fallbackReason,
              context,
              partialWork,
              envelope,
            );
            const duration_ms = Date.now() - startedAt;
            await this.appendAuditEventFromWorkflowStep(context, envelope, fallbackResult.status, duration_ms);
            if (this.agentRunRepository) {
              await this.agentRunRepository.create({
                id: runId,
                processInstanceId,
                stepId,
                pluginId,
                autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
                status: fallbackResult.status,
                envelope: fallbackResult.envelope,
                fallbackReason: fallbackResult.fallbackReason,
                startedAt: new Date(startedAt).toISOString(),
                completedAt: new Date().toISOString(),
              });
            }
            return fallbackResult;
          }

          const result = await this.applyAutonomyBehaviorForWorkflowStep(autonomyLevel, envelope, context);
          const duration_ms = Date.now() - startedAt;
          await this.appendAuditEventFromWorkflowStep(context, envelope, result.status, duration_ms);
          if (this.agentRunRepository) {
            await this.agentRunRepository.create({
              id: runId,
              processInstanceId,
              stepId,
              pluginId,
              autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
              status: result.status,
              envelope: result.envelope,
              fallbackReason: result.fallbackReason,
              startedAt: new Date(startedAt).toISOString(),
              completedAt: new Date().toISOString(),
            });
          }
          return result;
        }
      }
    } catch (err) {
      if (err instanceof AgentTimeoutError) {
        fallbackReason = 'timeout';
      } else {
        fallbackReason = 'error';
        caughtErrorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    const partialWork = this.eventLog.getPartialWork(processInstanceId, stepId);
    const fallbackResult = await this.fallbackHandler.handleWithWorkflowStep(
      fallbackReason!,
      context,
      partialWork,
    );
    const duration_ms = Date.now() - startedAt;
    await this.appendAuditEventFromWorkflowStep(context, null, fallbackResult.status, duration_ms, caughtErrorMessage);
    if (this.agentRunRepository) {
      await this.agentRunRepository.create({
        id: runId,
        processInstanceId,
        stepId,
        pluginId,
        autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
        status: fallbackResult.status,
        envelope: fallbackResult.envelope,
        fallbackReason: fallbackResult.fallbackReason,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
      });
    }
    return { ...fallbackResult, errorMessage: caughtErrorMessage };
  }

  /**
   * @deprecated Use runWithWorkflowStep instead. This method relies on the legacy
   * StepConfig model which is being replaced by WorkflowStep.
   */
  async run(
    plugin: AgentPlugin,
    context: AgentContext,
    stepConfig: StepConfig,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const { processInstanceId, stepId, autonomyLevel } = context;
    const runId = randomUUID();
    const pluginId = stepConfig.plugin ?? context.stepId;

    // Persist initial 'running' state if repository is provided
    if (this.agentRunRepository) {
      await this.agentRunRepository.create({
        id: runId,
        processInstanceId,
        stepId,
        pluginId,
        autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
        status: 'running',
        envelope: null,
        fallbackReason: null,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: null,
      });
    }

    // Build emit function wired to event log
    const emit = async (event: EmitPayload): Promise<void> => {
      await this.eventLog.write(processInstanceId, stepId, event);
    };

    // Initialize plugin
    await plugin.initialize(context);

    // Set up timeout
    const timeoutMs = (stepConfig.timeoutMinutes ?? 30) * 60_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new AgentTimeoutError()), timeoutMs);
    });

    let fallbackReason: 'timeout' | 'low_confidence' | 'error' | null = null;
    let caughtErrorMessage: string | null = null;

    try {
      // Race plugin run against timeout
      await Promise.race([plugin.run(emit), timeoutPromise]);

      // Find result event (last event with type === 'result')
      const events = this.eventLog.getEvents(processInstanceId, stepId);
      const resultEvent = [...events].reverse().find((e) => e.type === 'result');

      if (!resultEvent) {
        // No result event emitted — treat as error
        fallbackReason = 'error';
      } else {
        // Validate against AgentOutputEnvelopeSchema
        const parseResult = AgentOutputEnvelopeSchema.safeParse(resultEvent.payload);
        if (!parseResult.success) {
          fallbackReason = 'error';
        } else {
          const envelope = parseResult.data;

          // Check confidence threshold
          const threshold = stepConfig.confidenceThreshold ?? 0;
          if (envelope.confidence < threshold) {
            fallbackReason = 'low_confidence';
          }

          if (fallbackReason) {
            // Delegate to fallback handler for low_confidence
            const partialWork = this.eventLog.getPartialWork(processInstanceId, stepId);
            const fallbackResult = await this.fallbackHandler.handle(
              fallbackReason,
              context,
              stepConfig,
              partialWork,
              envelope,
            );
            const duration_ms = Date.now() - startedAt;
            await this.appendAuditEvent(context, stepConfig, envelope, fallbackResult.status, duration_ms);
            if (this.agentRunRepository) {
              await this.agentRunRepository.create({
                id: runId,
                processInstanceId,
                stepId,
                pluginId,
                autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
                status: fallbackResult.status,
                envelope: fallbackResult.envelope,
                fallbackReason: fallbackResult.fallbackReason,
                startedAt: new Date(startedAt).toISOString(),
                completedAt: new Date().toISOString(),
              });
            }
            return fallbackResult;
          }

          // Success path — apply autonomy behavior
          const result = await this.applyAutonomyBehavior(autonomyLevel, envelope, context);
          const duration_ms = Date.now() - startedAt;
          await this.appendAuditEvent(context, stepConfig, envelope, result.status, duration_ms);
          if (this.agentRunRepository) {
            await this.agentRunRepository.create({
              id: runId,
              processInstanceId,
              stepId,
              pluginId,
              autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
              status: result.status,
              envelope: result.envelope,
              fallbackReason: result.fallbackReason,
              startedAt: new Date(startedAt).toISOString(),
              completedAt: new Date().toISOString(),
            });
          }
          return result;
        }
      }
    } catch (err) {
      if (err instanceof AgentTimeoutError) {
        fallbackReason = 'timeout';
      } else {
        // Unexpected error — treat as error fallback, preserve message for audit
        fallbackReason = 'error';
        caughtErrorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    // Fallback path (timeout or error with no envelope)
    const partialWork = this.eventLog.getPartialWork(processInstanceId, stepId);
    const fallbackResult = await this.fallbackHandler.handle(
      fallbackReason!,
      context,
      stepConfig,
      partialWork,
    );
    const duration_ms = Date.now() - startedAt;
    await this.appendAuditEvent(context, stepConfig, null, fallbackResult.status, duration_ms, caughtErrorMessage);
    if (this.agentRunRepository) {
      await this.agentRunRepository.create({
        id: runId,
        processInstanceId,
        stepId,
        pluginId,
        autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
        status: fallbackResult.status,
        envelope: fallbackResult.envelope,
        fallbackReason: fallbackResult.fallbackReason,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
      });
    }
    return fallbackResult;
  }

  private async applyAutonomyBehaviorForWorkflowStep(
    level: string,
    envelope: AgentOutputEnvelope,
    context: WorkflowAgentContext,
  ): Promise<AgentRunResult> {
    const { processInstanceId, stepId } = context;

    switch (level) {
      case 'L0':
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };

      case 'L1':
        await this.eventLog.write(processInstanceId, stepId, {
          type: 'shadow_result',
          payload: envelope,
          timestamp: new Date().toISOString(),
        });
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };

      case 'L2':
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };

      case 'L3':
        await this.instanceRepository.update(context.processInstanceId, {
          status: 'paused',
          pauseReason: 'awaiting_agent_approval',
        });
        return { status: 'paused', envelope, appliedToWorkflow: false, fallbackReason: null };

      case 'L4':
        return { status: 'completed', envelope, appliedToWorkflow: true, fallbackReason: null };

      default:
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };
    }
  }

  private async appendAuditEventFromWorkflowStep(
    context: WorkflowAgentContext,
    envelope: AgentOutputEnvelope | null,
    runStatus: AgentRunStatus,
    duration_ms: number,
    errorMessage: string | null = null,
  ): Promise<void> {
    const pluginId = context.step.plugin ?? context.stepId;
    const reviewerType = context.autonomyLevel === 'L4'
      ? 'none'
      : context.autonomyLevel === 'L3'
        ? (context.step.review?.type ?? 'human')
        : 'none';

    await this.auditRepository.append({
      actorId: `agent:${pluginId}`,
      actorType: 'agent',
      actorRole: context.autonomyLevel,
      action: 'agent.run',
      description: `Agent run completed with status '${runStatus}' at autonomy level ${context.autonomyLevel}`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        stepInput: context.stepInput,
        autonomyLevel: context.autonomyLevel,
        model: context.step.agent?.model ?? envelope?.model ?? null,
      },
      outputSnapshot: {
        status: runStatus,
        confidence: envelope?.confidence ?? null,
        model: envelope?.model ?? null,
        duration_ms,
        reasoning_summary: envelope?.reasoning_summary ?? null,
        result: envelope?.result ?? null,
        ...(errorMessage !== null ? { error: errorMessage } : {}),
      },
      basis: `Autonomy level ${context.autonomyLevel} — ${this.getBasisDescription(context.autonomyLevel)}`,
      entityType: 'process_instance',
      entityId: context.processInstanceId,
      processInstanceId: context.processInstanceId,
      stepId: context.stepId,
      processDefinitionVersion: context.definitionVersion,
      executorType: 'agent',
      reviewerType,
    });
  }

  private async applyAutonomyBehavior(
    level: string,
    envelope: AgentOutputEnvelope,
    context: AgentContext,
  ): Promise<AgentRunResult> {
    const { processInstanceId, stepId } = context;

    switch (level) {
      case 'L0':
        // Silent Observer — run completes but output not surfaced
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L1':
        // Shadow — emit shadow_result event to event log
        await this.eventLog.write(processInstanceId, stepId, {
          type: 'shadow_result',
          payload: envelope,
          timestamp: new Date().toISOString(),
        });
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L2':
        // Annotator — annotations already in event log from plugin emissions
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L3':
        // Advisor — pause instance awaiting approval
        await this.instanceRepository.update(context.processInstanceId, {
          status: 'paused',
          pauseReason: 'awaiting_agent_approval',
        });
        return {
          status: 'paused',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L4':
        // Autopilot — result returned as step output for workflow
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: true,
          fallbackReason: null,
        };

      default:
        // Unknown autonomy level — treat as L0 (safe default)
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };
    }
  }

  private async appendAuditEvent(
    context: AgentContext,
    stepConfig: StepConfig,
    envelope: AgentOutputEnvelope | null,
    runStatus: AgentRunStatus,
    duration_ms: number,
    errorMessage: string | null = null,
  ): Promise<void> {
    // Derive reviewerType from autonomy level and stepConfig
    const reviewerType = context.autonomyLevel === 'L4'
      ? 'none'
      : context.autonomyLevel === 'L3'
        ? (stepConfig.reviewerType ?? 'human')
        : 'none';

    await this.auditRepository.append({
      actorId: `agent:${stepConfig.plugin ?? context.stepId}`,
      actorType: 'agent',
      actorRole: context.autonomyLevel,
      action: 'agent.run',
      description: `Agent run completed with status '${runStatus}' at autonomy level ${context.autonomyLevel}`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        stepInput: context.stepInput,
        autonomyLevel: context.autonomyLevel,
        model: stepConfig.model ?? envelope?.model ?? null,
      },
      outputSnapshot: {
        status: runStatus,
        confidence: envelope?.confidence ?? null,
        model: envelope?.model ?? null,
        duration_ms,
        reasoning_summary: envelope?.reasoning_summary ?? null,
        result: envelope?.result ?? null,
        ...(errorMessage !== null ? { error: errorMessage } : {}),
      },
      basis: `Autonomy level ${context.autonomyLevel} — ${this.getBasisDescription(context.autonomyLevel)}`,
      entityType: 'process_instance',
      entityId: context.processInstanceId,
      processInstanceId: context.processInstanceId,
      stepId: context.stepId,
      processDefinitionVersion: context.definitionVersion,
      executorType: 'agent',
      reviewerType,
    });
  }

  private getBasisDescription(level: string): string {
    const descriptions: Record<string, string> = {
      L0: 'Silent observer — output not surfaced to workflow',
      L1: 'Shadow mode — result stored for comparison only',
      L2: 'Annotator — annotations provided for human review',
      L3: 'Advisor — recommendation requires human approval',
      L4: 'Autopilot — result applied directly to workflow',
    };
    return descriptions[level] ?? 'Unknown autonomy level';
  }
}
