// Shared logic for executing a single agent step.
// Called directly by the run loop (no HTTP) to avoid undici's 300s headersTimeout
// when agent steps take longer than 5 minutes.
// Also imported by the advance route so the HTTP endpoint stays available for
// direct API calls without duplicating logic.
//
// Config-driven: resolves autonomy level, plugin, and all step settings from
// ProcessConfig via processRepo. No autonomyLevel parameter -- callers do not
// specify autonomy; it comes from config.
//
// L3 review routing: when an L3 step pauses, it routes to either a human
// reviewer (creates HumanTask) or an agent reviewer (invokes review plugin).
//
// appContext is a generic bag of key-value pairs provided by the calling app.
// Each app provides its own context, e.g. { studyId: '...' } or { supplierId: '...', ... }.
// Plugins read what they need from AgentContext.stepInput (which is set to appContext).

import { getPlatformServices } from './platform-services';
import type { AgentContext, AgentPlugin, ReviewPlugin, AgentRunResult } from '@mediforce/agent-runtime';
import type { StepConfig, AgentOutputEnvelope, ProcessInstance } from '@mediforce/platform-core';
import type { PlatformServices } from './platform-services';

export interface AgentStepResult {
  instanceId: string;
  status: string;
  currentStepId: string | null;
  agentRunStatus: string;
}

export async function executeAgentStep(
  instanceId: string,
  stepId: string,
  appContext: Record<string, unknown>,
  triggeredBy: string,
): Promise<AgentStepResult> {
  const { engine, agentRunner, pluginRegistry, instanceRepo, processRepo, llmClient, auditRepo, humanTaskRepo } = getPlatformServices();

  const instance = await instanceRepo.getById(instanceId);
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  // Resolve ProcessConfig from repository -- single source of truth (3-part key)
  const processConfig = await processRepo.getProcessConfig(
    instance.definitionName,
    instance.configName,
    instance.configVersion,
  );
  if (!processConfig) {
    throw new Error(
      `ProcessConfig not found for '${instance.definitionName}' @ ${instance.configName}:${instance.configVersion}`,
    );
  }

  // Find StepConfig for this step
  const stepConfig = processConfig.stepConfigs.find((sc) => sc.stepId === stepId);
  if (!stepConfig) {
    throw new Error(
      `StepConfig not found for step '${stepId}' in ProcessConfig '${instance.definitionName}'`,
    );
  }

  // Resolve plugin: use stepConfig.plugin when set, fall back to stepId
  const pluginId = stepConfig.plugin ?? stepId;
  const plugin: AgentPlugin = pluginRegistry.get(pluginId);

  // Resolve autonomy level from config (not from caller)
  const autonomyLevel = stepConfig.autonomyLevel ?? 'L2';

  const agentContext: AgentContext = {
    stepId,
    processInstanceId: instanceId,
    definitionVersion: instance.definitionVersion,
    stepInput: appContext,
    autonomyLevel,
    config: processConfig,
    llm: llmClient,
    getPreviousStepOutputs: async () => {
      const executions = await instanceRepo.getStepExecutions(instanceId);
      const result: Record<string, unknown> = {};
      for (const exec of executions) {
        if (exec.output !== null) {
          result[exec.stepId] = exec.output;
        }
      }
      return result;
    },
  };

  const runResult = await agentRunner.run(plugin, agentContext, stepConfig);

  // ---- L3 Review Routing ----
  // When an L3 step pauses (awaiting approval), route to either human or agent reviewer.
  if (runResult.status === 'paused' && autonomyLevel === 'L3') {
    const reviewerType = stepConfig.reviewerType ?? 'human';

    if (reviewerType === 'agent') {
      // Agent reviewer path: invoke review plugin, process verdict
      return await handleAgentReview(
        instanceId, stepId, stepConfig, pluginId, instance, runResult, agentContext, appContext, triggeredBy,
        { engine, agentRunner, pluginRegistry, auditRepo, llmClient },
      );
    }

    // Human reviewer path (default): create HumanTask with agent output embedded
    await humanTaskRepo.create({
      id: crypto.randomUUID(),
      processInstanceId: instanceId,
      stepId,
      assignedRole: stepConfig.allowedRoles?.[0] ?? 'reviewer',
      assignedUserId: null,
      status: 'pending',
      deadline: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: {
          confidence: runResult.envelope?.confidence ?? null,
          reasoning: runResult.envelope?.reasoning_summary ?? null,
          result: runResult.envelope?.result ?? null,
          model: runResult.envelope?.model ?? null,
          annotations: runResult.envelope?.annotations ?? null,
          duration_ms: runResult.envelope?.duration_ms ?? null,
        },
        iterationNumber: 0,
      },
    });

    const currentInstance = await instanceRepo.getById(instanceId);
    return {
      instanceId,
      status: currentInstance?.status ?? 'paused',
      currentStepId: currentInstance?.currentStepId ?? null,
      agentRunStatus: runResult.status,
    };
  }

  // ---- Escalation/Pause (non-L3) ----
  if (runResult.status === 'escalated' || runResult.status === 'paused') {
    const reviewerType = autonomyLevel === 'L4' ? 'none' : 'none';

    await auditRepo.append({
      actorId: `agent:${pluginId}`,
      actorType: 'agent',
      actorRole: autonomyLevel,
      action: 'agent.escalated',
      description: `Step '${stepId}' escalated to human review — reason: ${runResult.fallbackReason ?? 'unknown'}`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { stepId, fallbackReason: runResult.fallbackReason ?? null },
      outputSnapshot: { status: runResult.status },
      basis: 'FallbackHandler: fallbackBehavior=escalate_to_human — agent could not complete step autonomously',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      stepId,
      processDefinitionVersion: instance.definitionVersion,
      executorType: 'agent',
      reviewerType,
    });
    const currentInstance = await instanceRepo.getById(instanceId);
    return {
      instanceId,
      status: currentInstance?.status ?? 'paused',
      currentStepId: currentInstance?.currentStepId ?? null,
      agentRunStatus: runResult.status,
    };
  }

  // L4: appliedToWorkflow=true -- advance the step
  if (runResult.appliedToWorkflow) {
    const updatedInstance = await engine.advanceStep(
      instanceId,
      { agentStatus: runResult.status, agentOutput: runResult.envelope?.result ?? null },
      { id: triggeredBy, role: 'agent' },
      stepConfig,
      runResult,
    );

    return {
      instanceId,
      status: updatedInstance.status,
      currentStepId: updatedInstance.currentStepId,
      agentRunStatus: runResult.status,
    };
  }

  // L0/L1/L2: no advance, no review task
  const currentInstance = await instanceRepo.getById(instanceId);
  return {
    instanceId,
    status: currentInstance?.status ?? instance.status,
    currentStepId: currentInstance?.currentStepId ?? instance.currentStepId,
    agentRunStatus: runResult.status,
  };
}

// ---- Agent Review Loop ----
// Invokes a review plugin, processes the verdict, and either advances (approve)
// or re-invokes the executor with feedback (reject/revise), bounded by maxIterations.

async function handleAgentReview(
  instanceId: string,
  stepId: string,
  stepConfig: StepConfig,
  pluginId: string,
  instance: Pick<ProcessInstance, 'definitionVersion'>,
  initialRunResult: AgentRunResult,
  agentContext: AgentContext,
  appContext: Record<string, unknown>,
  triggeredBy: string,
  services: Pick<PlatformServices, 'engine' | 'agentRunner' | 'pluginRegistry' | 'auditRepo' | 'llmClient'>,
): Promise<AgentStepResult> {
  const reviewerPluginId = stepConfig.reviewerPlugin;
  if (!reviewerPluginId) {
    throw new Error(`reviewerPlugin required when reviewerType='agent' for step '${stepId}'`);
  }

  // Review plugins are stored in the same registry as agent plugins.
  // Cast through unknown since the registry types AgentPlugin but review plugins implement ReviewPlugin.
  const reviewPlugin = services.pluginRegistry.get(reviewerPluginId) as unknown as ReviewPlugin;
  const maxIterations = stepConfig.reviewConstraints?.maxIterations ?? 3;

  let iterationNumber = 0;
  let currentEnvelope: AgentOutputEnvelope | null = initialRunResult.envelope;
  let previousFeedback: string | undefined;

  while (iterationNumber < maxIterations) {
    const reviewResult = await reviewPlugin.review({
      stepId,
      processInstanceId: instanceId,
      executorOutput: currentEnvelope!,
      iterationNumber,
      previousFeedback,
      llm: agentContext.llm,
    });

    // Emit review audit event with executorType and reviewerType as top-level fields
    await services.auditRepo.append({
      actorId: `agent:${reviewerPluginId}`,
      actorType: 'agent',
      actorRole: 'reviewer',
      action: 'review.completed',
      description: `Review verdict: ${reviewResult.verdict} (confidence: ${reviewResult.confidence})`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { executorOutput: currentEnvelope, iterationNumber },
      outputSnapshot: {
        verdict: reviewResult.verdict,
        reasoning: reviewResult.reasoning,
        feedback: reviewResult.feedback ?? null,
      },
      basis: `Agent reviewer '${reviewerPluginId}' at autonomy L3`,
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      stepId,
      processDefinitionVersion: instance.definitionVersion,
      executorType: 'agent',
      reviewerType: 'agent',
    });

    if (reviewResult.verdict === 'approve') {
      // Advance the step
      const updatedInstance = await services.engine.advanceStep(
        instanceId,
        { agentStatus: 'completed', agentOutput: currentEnvelope?.result ?? null },
        { id: triggeredBy, role: 'agent' },
        stepConfig,
      );

      return {
        instanceId,
        status: updatedInstance.status,
        currentStepId: updatedInstance.currentStepId,
        agentRunStatus: 'completed',
      };
    }

    // reject/revise: re-invoke executor with feedback
    iterationNumber++;
    previousFeedback = reviewResult.feedback;

    if (iterationNumber >= maxIterations) {
      throw new Error(`Max review iterations (${maxIterations}) exhausted for step '${stepId}'`);
    }

    // Re-run the executor plugin with feedback in stepInput
    const retryContext: AgentContext = {
      ...agentContext,
      stepInput: { ...appContext, reviewFeedback: previousFeedback },
    };

    const plugin = services.pluginRegistry.get(pluginId) as AgentPlugin;
    const retryResult = await services.agentRunner.run(plugin, retryContext, stepConfig);
    currentEnvelope = retryResult.envelope;
  }

  // Should not reach here due to the throw inside the loop, but safety net
  throw new Error(`Max review iterations (${maxIterations}) exhausted for step '${stepId}'`);
}
