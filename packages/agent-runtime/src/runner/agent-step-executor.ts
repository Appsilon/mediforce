import {
  calculateEstimatedCost,
  CANCELLED_BY_USER_ERROR,
  type AgentOutputEnvelope,
} from '@mediforce/platform-core';
import type { StepExecutorPlugin, WorkflowAgentContext } from '../interfaces/step-executor-plugin';
import type { AgentRunner, AgentRunResult } from './agent-runner';
import type {
  StepExecutor,
  StepExecutorServices,
  StepExecutorMeta,
  StepExecutionResult,
} from './step-executor';

export class AgentStepExecutor implements StepExecutor {
  constructor(private readonly agentRunner: AgentRunner) {}

  async execute(
    plugin: StepExecutorPlugin,
    context: WorkflowAgentContext,
    services: StepExecutorServices,
    meta: StepExecutorMeta,
  ): Promise<StepExecutionResult> {
    const { auditRepo, instanceRepo, engine, humanTaskRepo, modelRegistryRepo } = services;
    const { instanceId, stepId, pluginId, triggeredBy, stepExecutionId, definitionVersion } = meta;
    const autonomyLevel = context.autonomyLevel;
    const workflowStep = context.step;

    await auditRepo.append({
      actorId: `agent:${pluginId}`,
      actorType: 'agent',
      actorRole: autonomyLevel,
      action: 'agent.step.started',
      description: `Workflow agent step '${stepId}' started (plugin: ${pluginId}, autonomy: ${autonomyLevel})`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { stepId, pluginId, autonomyLevel, ...context.stepInput },
      outputSnapshot: {},
      basis: `Triggered by ${triggeredBy}`,
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      stepId,
      processDefinitionVersion: definitionVersion,
      executorType: 'agent',
      reviewerType: 'none',
    });

    const runResult = await this.agentRunner.runWithWorkflowStep(plugin, context);

    const envelope = runResult.envelope;
    const costResult = envelope ? await estimateCostField(envelope, modelRegistryRepo, stepId) : {};

    if (stepExecutionId) {
      const isFailed = runResult.fallbackReason === 'error' || runResult.fallbackReason === 'timeout';
      const isEscalatedToL3Review = autonomyLevel === 'L3' && runResult.status === 'escalated' && !isFailed;
      await instanceRepo.updateStepExecution(instanceId, stepExecutionId, {
        output: envelope?.result ?? null,
        status: !isFailed && (runResult.status === 'completed' || runResult.status === 'paused' || isEscalatedToL3Review) ? 'completed' : 'failed',
        completedAt: new Date().toISOString(),
        ...(isFailed && runResult.errorMessage ? { error: runResult.errorMessage } : {}),
        agentOutput: envelope
          ? {
              confidence: envelope.confidence ?? null,
              confidence_rationale: envelope.confidence_rationale ?? null,
              reasoning: envelope.reasoning_summary ?? null,
              model: envelope.model ?? null,
              duration_ms: envelope.duration_ms ?? null,
              gitMetadata: envelope.gitMetadata ?? null,
              deliverableFile: (envelope.deliverableFile as string | undefined) ?? null,
              presentation: envelope.presentation ?? null,
              ...(envelope.tokenUsage ? { tokenUsage: envelope.tokenUsage } : {}),
              ...costResult,
            }
          : null,
      });
    }

    const isFailed = runResult.fallbackReason === 'error' || runResult.fallbackReason === 'timeout';
    if (isFailed) {
      const failLabel = runResult.fallbackReason === 'timeout' ? 'timed out' : 'failed';
      const errorDetail = runResult.errorMessage ?? (runResult.fallbackReason === 'timeout' ? 'agent execution timed out' : null);
      if (errorDetail !== null) {
        await instanceRepo.update(instanceId, {
          error: `Agent step '${stepId}' ${failLabel}: ${errorDetail}`,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Persist output to instance.variables + accumulate cost. Fetch the instance
    // once here — the cancel-marker check below reuses the same read rather than
    // issuing a back-to-back getById (status/error are not changed by this update,
    // so the pre-update snapshot is valid for the marker check).
    const agentOutput = envelope?.result ?? null;
    const stepCost = costResult.estimatedCostUsd;
    const instanceAfterRun = await instanceRepo.getById(instanceId);
    if ((agentOutput !== null || stepCost !== undefined) && instanceAfterRun) {
      await instanceRepo.update(instanceId, {
        ...(agentOutput !== null ? {
          variables: {
            ...instanceAfterRun.variables,
            [stepId]: agentOutput,
          },
        } : {}),
        ...(stepCost !== undefined ? {
          totalCostUsd: (instanceAfterRun.totalCostUsd ?? 0) + stepCost,
        } : {}),
      });
    }

    // The operator may cancel a run mid-step (cancelRun flips it to
    // status: 'failed' with error: 'Cancelled by user' while the agent
    // container is still running). The step's recovered cost above is already
    // persisted onto totalCostUsd and the step execution's agentOutput, so
    // surface it rather than calling advanceStep — the instance is no longer
    // 'running', so advancing would throw InvalidTransitionError and the
    // auto-runner's catch would clobber the cancellation reason with that
    // error. Returning here keeps the cancel reason intact and lets the
    // accumulated cost show in both the list and detail views.
    const wasCancelledDuringStep =
      instanceAfterRun !== null
      && instanceAfterRun.status === 'failed'
      && instanceAfterRun.error === CANCELLED_BY_USER_ERROR;
    if (wasCancelledDuringStep) {
      return {
        status: 'completed',
        envelope,
        appliedToWorkflow: false,
        fallbackReason: runResult.fallbackReason,
        executorType: 'agent',
        instanceState: { status: 'failed', currentStepId: instanceAfterRun.currentStepId },
      };
    }

    // Helper: create a human review task for L3 escalation
    const createAgentReviewHumanTask = async (
      escalationReason: 'low_confidence' | 'timeout' | 'error' | 'iterations_limit' | null,
      auditBasis: string,
    ): Promise<void> => {
      const reviewTaskId = crypto.randomUUID();
      const reviewTaskNow = new Date().toISOString();
      const assignedRole = workflowStep.allowedRoles?.[0] ?? 'reviewer';

      const priorReviewExecutions = (await instanceRepo.getStepExecutions(instanceId))
        .filter((e) => e.stepId === stepId).length;

      await humanTaskRepo.create({
        id: reviewTaskId,
        processInstanceId: instanceId,
        stepId,
        assignedRole,
        assignedUserId: null,
        status: 'pending',
        deadline: null,
        createdAt: reviewTaskNow,
        updatedAt: reviewTaskNow,
        completedAt: null,
        completionData: {
          reviewType: 'agent_output_review',
          agentOutput: {
            confidence: envelope?.confidence ?? null,
            reasoning: envelope?.reasoning_summary ?? null,
            result: envelope?.result ?? null,
            model: envelope?.model ?? null,
            annotations: envelope?.annotations ?? null,
            duration_ms: envelope?.duration_ms ?? null,
            gitMetadata: envelope?.gitMetadata ?? null,
            presentation: envelope?.presentation ?? null,
            escalationReason,
          },
          iterationNumber: priorReviewExecutions,
        },
        creationReason: 'agent_review_l3',
      });

      await auditRepo.append({
        actorId: `agent:${pluginId}`,
        actorType: 'agent',
        actorRole: autonomyLevel,
        action: 'task.created',
        description: `Human task created for workflow step '${stepId}' (reason: agent_review_l3)`,
        timestamp: reviewTaskNow,
        inputSnapshot: { taskId: reviewTaskId, stepId, reason: 'agent_review_l3', assignedRole },
        outputSnapshot: {},
        basis: auditBasis,
        entityType: 'humanTask',
        entityId: reviewTaskId,
        processInstanceId: instanceId,
        stepId,
        processDefinitionVersion: definitionVersion,
        executorType: 'agent',
        reviewerType: 'human',
      });

      await instanceRepo.update(instanceId, {
        status: 'paused',
        pauseReason: 'waiting_for_human',
        updatedAt: new Date().toISOString(),
      });
    };

    // ---- L3 Review Routing (skip when agent errored) ----
    if ((runResult.status === 'paused' || runResult.status === 'escalated') && autonomyLevel === 'L3' && runResult.fallbackReason !== 'error') {
      const reviewerType = workflowStep.review?.type ?? 'human';
      const isEscalation = runResult.status === 'escalated';

      if (reviewerType === 'human' || reviewerType === 'none' || isEscalation) {
        await createAgentReviewHumanTask(
          isEscalation ? runResult.fallbackReason : null,
          'L3 workflow agent step paused — human reviewer task created',
        );
        return {
          status: 'paused',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: runResult.fallbackReason,
          executorType: 'agent',
          instanceState: { status: 'paused', currentStepId: stepId },
        };
      }
    }

    // ---- L3 Agent-as-Reviewer: submit verdict ----
    if (
      autonomyLevel === 'L3' &&
      workflowStep.review?.type === 'agent' &&
      workflowStep.type === 'review' &&
      runResult.status === 'completed' &&
      runResult.appliedToWorkflow
    ) {
      const resultObj =
        envelope?.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : null;
      const verdictValue = typeof resultObj?.verdict === 'string' ? resultObj.verdict : null;

      if (verdictValue === null || verdictValue.length === 0) {
        await createAgentReviewHumanTask(
          'error',
          `Agent reviewer for step '${stepId}' returned envelope without a verdict`,
        );
        return {
          status: 'escalated',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
          executorType: 'agent',
          instanceState: { status: 'paused', currentStepId: stepId },
        };
      }

      const commentValue = typeof resultObj?.comment === 'string' ? resultObj.comment : null;
      const reviewerId = `agent:${pluginId}`;

      const updated = await engine.submitReviewVerdict(
        instanceId,
        stepId,
        {
          reviewerId,
          reviewerRole: 'agent',
          verdict: verdictValue,
          comment: commentValue,
          timestamp: new Date().toISOString(),
        },
        { id: reviewerId, role: 'agent' },
      );

      if (updated.status === 'paused' && updated.pauseReason === 'max_iterations_exceeded') {
        await createAgentReviewHumanTask(
          'iterations_limit',
          `Agent reviewer for step '${stepId}' exhausted iteration limit`,
        );
        return {
          status: 'escalated',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
          executorType: 'agent',
          instanceState: { status: 'paused', currentStepId: stepId },
        };
      }

      return {
        status: 'completed' as const,
        envelope,
        appliedToWorkflow: true,
        fallbackReason: null,
        executorType: 'agent',
        instanceState: { status: updated.status, currentStepId: updated.currentStepId },
      };
    }

    // ---- Escalation/Pause (non-L3) ----
    if (runResult.status === 'escalated' || runResult.status === 'paused') {
      const escalationStatus = runResult.status;
      await auditRepo.append({
        actorId: `agent:${pluginId}`,
        actorType: 'agent',
        actorRole: autonomyLevel,
        action: 'agent.escalated',
        description: `Workflow step '${stepId}' escalated — reason: ${runResult.fallbackReason ?? 'unknown'}`,
        timestamp: new Date().toISOString(),
        inputSnapshot: { stepId, fallbackReason: runResult.fallbackReason ?? null },
        outputSnapshot: { status: escalationStatus },
        basis: 'FallbackHandler: agent could not complete step autonomously',
        entityType: 'processInstance',
        entityId: instanceId,
        processInstanceId: instanceId,
        stepId,
        processDefinitionVersion: definitionVersion,
        executorType: 'agent',
        reviewerType: 'none',
      });
      return {
        status: escalationStatus,
        envelope,
        appliedToWorkflow: false,
        fallbackReason: runResult.fallbackReason,
        executorType: 'agent',
      };
    }

    // L4: appliedToWorkflow=true — advance
    if (runResult.appliedToWorkflow) {
      const stepResult = runResult.envelope?.result;
      if (stepResult === null || stepResult === undefined) {
        throw new Error(
          `Workflow step '${stepId}' completed with null result — cannot advance. ` +
          `Reason: ${runResult.fallbackReason ?? runResult.envelope?.reasoning_summary ?? 'unknown'}`,
        );
      }

      const updatedInstance = await engine.advanceStep(
        instanceId,
        stepResult,
        { id: triggeredBy, role: 'agent' },
        undefined,
        runResult,
      );

      return {
        status: 'completed' as const,
        envelope,
        appliedToWorkflow: true,
        fallbackReason: null,
        executorType: 'agent',
        instanceState: { status: updatedInstance.status, currentStepId: updatedInstance.currentStepId },
      };
    }

    // L0/L1/L2: agent completed but didn't auto-apply — advance to next step
    if (runResult.status === 'completed') {
      const stepResult = runResult.envelope?.result ?? {};
      const updatedInstance = await engine.advanceStep(
        instanceId,
        stepResult,
        { id: triggeredBy, role: 'agent' },
        undefined,
      );

      return {
        status: 'completed' as const,
        envelope,
        appliedToWorkflow: false,
        fallbackReason: null,
        executorType: 'agent',
        instanceState: { status: updatedInstance.status, currentStepId: updatedInstance.currentStepId },
      };
    }

    // Fallback: unknown status — should not reach here
    return {
      status: 'completed',
      envelope,
      appliedToWorkflow: false,
      fallbackReason: runResult.fallbackReason,
      executorType: 'agent',
    };
  }
}

async function estimateCostField(
  envelope: { model: string | null; tokenUsage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; peakInputTokens?: number } },
  modelRegistryRepo: { getById(id: string): Promise<{ pricing: { input: number; output: number; cacheRead?: number }; contextLength: number } | null> },
  stepId: string,
): Promise<{ estimatedCostUsd: number } | Record<string, never>> {
  if (!envelope.tokenUsage || !envelope.model) return {};
  const entry = await modelRegistryRepo.getById(envelope.model);
  if (!entry) {
    console.warn(`[cost] model "${envelope.model}" not found in registry — cost unavailable`);
    return {};
  }
  logContextSaturation(stepId, envelope.model, envelope.tokenUsage.peakInputTokens, entry.contextLength);
  return { estimatedCostUsd: calculateEstimatedCost(envelope.tokenUsage, entry.pricing) };
}

// Peak single-turn prompt vs the model's context window. This is the signal for
// sizing agent batches (e.g. how many issues to hand triage at once): push the
// batch up while peak saturation stays under a quality ceiling — model recall
// degrades well before the hard limit — rather than aiming for 100%.
function logContextSaturation(
  stepId: string,
  model: string,
  peakInputTokens: number | undefined,
  contextLength: number,
): void {
  if (peakInputTokens === undefined || peakInputTokens <= 0 || contextLength <= 0) return;
  const saturationPct = Math.round((peakInputTokens / contextLength) * 100);
  console.log(
    `[saturation] step "${stepId}" (${model}): peak ${peakInputTokens}/${contextLength} tokens = ${saturationPct}%`,
  );
}
