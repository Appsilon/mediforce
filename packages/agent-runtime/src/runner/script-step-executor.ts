import {
  StepOutputEnvelopeSchema,
  resolveStepTimeoutMinutes,
  type StepOutputEnvelope,
} from '@mediforce/platform-core';
import type { AgentPlugin, WorkflowAgentContext } from '../interfaces/agent-plugin';
import type { PluginRunner } from './plugin-runner';
import type {
  StepExecutor,
  StepExecutorServices,
  StepExecutorMeta,
  StepExecutionResult,
} from './step-executor';

export class ScriptStepExecutor implements StepExecutor {
  constructor(private readonly pluginRunner: PluginRunner) {}

  async execute(
    plugin: AgentPlugin,
    context: WorkflowAgentContext,
    services: StepExecutorServices,
    meta: StepExecutorMeta,
  ): Promise<StepExecutionResult> {
    const { auditRepo, instanceRepo, engine, modelRegistryRepo } = services;
    const { instanceId, stepId, pluginId, triggeredBy, stepExecutionId, definitionVersion } = meta;

    await auditRepo.append({
      actorId: `script:${pluginId}`,
      actorType: 'system',
      actorRole: 'L4',
      action: 'script.step.started',
      description: `Script step '${stepId}' started (plugin: ${pluginId})`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { stepId, pluginId, ...context.stepInput },
      outputSnapshot: {},
      basis: `Triggered by ${triggeredBy}`,
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      stepId,
      processDefinitionVersion: definitionVersion,
      executorType: 'script',
      reviewerType: 'none',
    });

    const timeoutMs = resolveStepTimeoutMinutes(context.step) * 60_000;
    const { resultPayload, timedOut, errorMessage } = await this.pluginRunner.execute(
      plugin, context, timeoutMs,
    );

    let envelope: StepOutputEnvelope | null = null;
    let fallbackReason: 'timeout' | 'error' | null = null;

    if (timedOut) {
      fallbackReason = 'timeout';
    } else if (errorMessage !== null) {
      fallbackReason = 'error';
    } else if (resultPayload === null) {
      fallbackReason = 'error';
    } else {
      const parseResult = StepOutputEnvelopeSchema.safeParse(resultPayload);
      if (!parseResult.success) {
        fallbackReason = 'error';
      } else {
        envelope = parseResult.data;
      }
    }

    if (stepExecutionId) {
      const isFailed = fallbackReason !== null;
      await instanceRepo.updateStepExecution(instanceId, stepExecutionId, {
        output: envelope?.result ?? null,
        status: isFailed ? 'failed' : 'completed',
        completedAt: new Date().toISOString(),
        ...(isFailed && errorMessage ? { error: errorMessage } : {}),
        agentOutput: envelope
          ? {
              confidence: null,
              confidence_rationale: null,
              reasoning: null,
              model: null,
              duration_ms: envelope.duration_ms ?? null,
              gitMetadata: envelope.gitMetadata ?? null,
              deliverableFile: (envelope.deliverableFile as string | undefined) ?? null,
              presentation: envelope.presentation ?? null,
            }
          : null,
      });
    }

    if (fallbackReason !== null) {
      const failLabel = fallbackReason === 'timeout' ? 'timed out' : 'failed';
      const errorDetail = errorMessage ?? (fallbackReason === 'timeout' ? 'script execution timed out' : null);
      if (errorDetail !== null) {
        await instanceRepo.update(instanceId, {
          error: `Script step '${stepId}' ${failLabel}: ${errorDetail}`,
          updatedAt: new Date().toISOString(),
        });
      }

      await auditRepo.append({
        actorId: `script:${pluginId}`,
        actorType: 'system',
        actorRole: 'L4',
        action: 'script.escalated',
        description: `Script step '${stepId}' failed — reason: ${fallbackReason}`,
        timestamp: new Date().toISOString(),
        inputSnapshot: { stepId, fallbackReason },
        outputSnapshot: { status: 'escalated' },
        basis: 'Script step could not complete',
        entityType: 'processInstance',
        entityId: instanceId,
        processInstanceId: instanceId,
        stepId,
        processDefinitionVersion: definitionVersion,
        executorType: 'script',
        reviewerType: 'none',
      });

      return {
        status: 'escalated',
        envelope,
        appliedToWorkflow: false,
        fallbackReason,
        errorMessage,
        executorType: 'script',
      };
    }

    // Script always auto-applies: persist output to variables then advance
    const scriptOutput = envelope?.result ?? null;
    if (scriptOutput !== null) {
      const freshInstance = await instanceRepo.getById(instanceId);
      if (freshInstance) {
        await instanceRepo.update(instanceId, {
          variables: {
            ...freshInstance.variables,
            [stepId]: scriptOutput,
          },
        });
      }
    }

    const stepResult = envelope?.result;
    if (stepResult === null || stepResult === undefined) {
      throw new Error(
        `Script step '${stepId}' completed with null result — cannot advance.`,
      );
    }

    const updatedInstance = await engine.advanceStep(
      instanceId,
      stepResult,
      { id: triggeredBy, role: 'agent' },
    );

    return {
      status: 'completed' as const,
      envelope,
      appliedToWorkflow: true,
      fallbackReason: null,
      executorType: 'script',
      instanceState: { status: updatedInstance.status, currentStepId: updatedInstance.currentStepId },
    };
  }
}
