import {
  StepOutputEnvelopeSchema,
  resolveStepTimeoutMinutes,
  type StepOutputEnvelope,
} from '@mediforce/platform-core';
import type { StepExecutorPlugin, WorkflowAgentContext } from '../interfaces/step-executor-plugin';
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
    plugin: StepExecutorPlugin,
    context: WorkflowAgentContext,
    services: StepExecutorServices,
    meta: StepExecutorMeta,
  ): Promise<StepExecutionResult> {
    const { auditRepo, instanceRepo, engine, modelRegistryRepo } = services;
    const { instanceId, stepId, pluginId, triggeredBy, stepExecutionId, definitionVersion } = meta;

    if (meta.reapTimedOut !== true) {
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
    }

    // Reap mode: the prior driver died with this step still running past its
    // timeout — synthesize the timeout instead of launching the plugin (ADR-0010).
    let resultPayload: unknown;
    let timedOut: boolean;
    let errorMessage: string | null;
    if (meta.reapTimedOut === true) {
      resultPayload = null;
      timedOut = true;
      errorMessage = 'Script step timed out — stranded past its timeout after its driver stopped';
    } else {
      const timeoutMs = resolveStepTimeoutMinutes(context.step) * 60_000;
      ({ resultPayload, timedOut, errorMessage } = await this.pluginRunner.execute(
        plugin, context, timeoutMs,
      ));
    }

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

    // In-flight cancel guard: if the run was cancelled/terminated out from under
    // us while the script was executing, cancelRun has already reaped this step's
    // StepExecution and flipped the instance to `failed`. Do NOT resurrect the
    // reaped execution with a late completion write, persist output onto the
    // cancelled instance, or advance — bail with the instance's terminal state.
    // `running` and `paused` are the only active states here (a reap flips it to
    // `failed` only further down), so they proceed normally.
    const guardInstance = await instanceRepo.getById(instanceId);
    if (
      guardInstance &&
      guardInstance.status !== 'running' &&
      guardInstance.status !== 'paused'
    ) {
      return {
        status: 'failed',
        envelope,
        appliedToWorkflow: false,
        fallbackReason,
        errorMessage,
        executorType: 'script',
        instanceState: { status: guardInstance.status, currentStepId: guardInstance.currentStepId },
      };
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
      if (fallbackReason === 'timeout') {
        // A timed-out (or reaped) script fails the run deterministically:
        // scripts have no escalation path (ADR-0008), so a dead-driver timeout
        // must terminate the run rather than leave it `running` for the
        // auto-runner loop-guard to eventually trip (ADR-0010). A live `error`
        // keeps its pre-ADR-0010 behaviour (record the error, stay `running`);
        // whether it should also hard-fail is tracked in #924.
        await instanceRepo.update(instanceId, {
          status: 'failed',
          error: `Script step '${stepId}' ${failLabel}: ${errorDetail}`,
          updatedAt: new Date().toISOString(),
        });
      } else if (errorDetail !== null) {
        await instanceRepo.update(instanceId, {
          error: `Script step '${stepId}' ${failLabel}: ${errorDetail}`,
          updatedAt: new Date().toISOString(),
        });
      }

      const truncatedError = errorDetail ? errorDetail.slice(0, 2000) : null;
      await auditRepo.append({
        actorId: `script:${pluginId}`,
        actorType: 'system',
        actorRole: 'L4',
        action: 'script.escalated',
        description: truncatedError
          ? `Script step '${stepId}' failed — ${truncatedError}`
          : `Script step '${stepId}' failed — reason: ${fallbackReason}`,
        timestamp: new Date().toISOString(),
        inputSnapshot: { stepId, fallbackReason },
        outputSnapshot: { status: 'escalated', ...(truncatedError ? { error: truncatedError } : {}) },
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
