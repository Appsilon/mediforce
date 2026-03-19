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

import { existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { getPlatformServices } from './platform-services';
import type { AgentContext, AgentPlugin, ReviewPlugin, AgentRunResult } from '@mediforce/agent-runtime';
import type { StepConfig, AgentOutputEnvelope, ProcessInstance, ProcessConfig } from '@mediforce/platform-core';
import type { PlatformServices } from './platform-services';

/** Walk up from cwd to find the monorepo root (contains pnpm-workspace.yaml). */
function findWorkspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return process.cwd(); // fallback
}

/** Resolve relative skillsDir paths in stepConfigs to absolute paths anchored at workspace root. */
function resolveSkillPaths(config: ProcessConfig): ProcessConfig {
  const needsResolve = config.stepConfigs.some(
    (sc) => sc.agentConfig?.skillsDir && !isAbsolute(sc.agentConfig.skillsDir),
  );
  if (!needsResolve) return config;

  const root = findWorkspaceRoot();
  return {
    ...config,
    stepConfigs: config.stepConfigs.map((sc) => {
      if (sc.agentConfig?.skillsDir && !isAbsolute(sc.agentConfig.skillsDir)) {
        return {
          ...sc,
          agentConfig: {
            ...sc.agentConfig,
            skillsDir: resolve(root, sc.agentConfig.skillsDir),
          },
        };
      }
      return sc;
    }),
  };
}

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
  stepExecutionId?: string,
): Promise<AgentStepResult> {
  const { engine, agentRunner, pluginRegistry, instanceRepo, processRepo, llmClient, auditRepo, humanTaskRepo } = getPlatformServices();

  const instance = await instanceRepo.getById(instanceId);
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  // Resolve ProcessConfig from repository -- single source of truth (3-part key)
  const processConfig = await processRepo.getProcessConfig(
    instance.definitionName,
    instance.configName ?? '',
    instance.configVersion ?? '',
  );
  if (!processConfig) {
    throw new Error(
      `ProcessConfig not found for '${instance.definitionName}' @ ${instance.configName}:${instance.configVersion}`,
    );
  }

  // Resolve relative skillsDir paths to absolute (Next.js cwd != workspace root)
  const resolvedConfig = resolveSkillPaths(processConfig);

  // Find StepConfig for this step
  const stepConfig = resolvedConfig.stepConfigs.find((sc) => sc.stepId === stepId);
  if (!stepConfig) {
    throw new Error(
      `StepConfig not found for step '${stepId}' in ProcessConfig '${instance.definitionName}'`,
    );
  }

  // Resolve plugin: use stepConfig.plugin when set, fall back to stepId
  const pluginId = stepConfig.plugin ?? stepId;
  const plugin: AgentPlugin = pluginRegistry.get(pluginId);

  // Resolve autonomy level from config (not from caller)
  // Script steps are deterministic — always auto-advance (L4) regardless of config
  const autonomyLevel = stepConfig.executorType === 'script'
    ? 'L4'
    : (stepConfig.autonomyLevel ?? 'L2');

  // Emit audit event so the UI shows agent step has started
  await auditRepo.append({
    actorId: `agent:${pluginId}`,
    actorType: 'agent',
    actorRole: autonomyLevel,
    action: 'agent.step.started',
    description: `Agent step '${stepId}' started (plugin: ${pluginId}, autonomy: ${autonomyLevel})`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { stepId, pluginId, autonomyLevel, ...appContext },
    outputSnapshot: {},
    basis: `Triggered by ${triggeredBy}`,
    entityType: 'processInstance',
    entityId: instanceId,
    processInstanceId: instanceId,
    stepId,
    processDefinitionVersion: instance.definitionVersion,
    executorType: 'agent',
    reviewerType: 'none',
  });

  // Merge step params from config into the input — params are the primary source,
  // appContext (from trigger payload / API body) can override or supplement
  const mergedInput: Record<string, unknown> = {
    ...(stepConfig.params ?? {}),
    ...appContext,
  };

  const agentContext: AgentContext = {
    stepId,
    processInstanceId: instanceId,
    definitionVersion: instance.definitionVersion,
    stepInput: mergedInput,
    autonomyLevel,
    config: resolvedConfig,
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

  // Persist agent output to step execution so getPreviousStepOutputs() returns it
  const envelope = runResult.envelope;
  if (stepExecutionId) {
    await instanceRepo.updateStepExecution(instanceId, stepExecutionId, {
      output: envelope?.result ?? null,
      status: runResult.status === 'completed' || runResult.status === 'paused' ? 'completed' : 'failed',
      completedAt: new Date().toISOString(),
      agentOutput: envelope ? {
        confidence: envelope.confidence ?? null,
        reasoning: envelope.reasoning_summary ?? null,
        model: envelope.model ?? null,
        duration_ms: envelope.duration_ms ?? null,
        gitMetadata: envelope.gitMetadata ?? null,
      } : null,
    });
  }

  // Also persist output to instance.variables so it's available to subsequent
  // steps even when the current step pauses (L3) or doesn't advance (L0/L1/L2).
  // getPreviousStepOutputs() reads from stepExecutions, but instance.variables
  // is the canonical workflow context used by advanceStep and step input resolution.
  const agentOutput = envelope?.result ?? null;
  if (agentOutput !== null) {
    const freshInstance = await instanceRepo.getById(instanceId);
    if (freshInstance) {
      await instanceRepo.update(instanceId, {
        variables: {
          ...freshInstance.variables,
          [stepId]: agentOutput,
        },
      });
    }
  }

  // ---- L3 Review Routing ----
  // When an L3 step pauses or escalates (low confidence / error), route to human or agent reviewer.
  // Both 'paused' (normal completion) and 'escalated' (fallback) need a review task created.
  if ((runResult.status === 'paused' || runResult.status === 'escalated') && autonomyLevel === 'L3') {
    const reviewerType = stepConfig.reviewerType ?? 'human';

    if (reviewerType === 'agent') {
      // Agent reviewer path: invoke review plugin, process verdict
      return await handleAgentReview(
        instanceId, stepId, stepConfig, pluginId, instance, runResult, agentContext, appContext, triggeredBy,
        { engine, agentRunner, pluginRegistry, auditRepo, llmClient },
      );
    }

    // Human reviewer path (default): create HumanTask with agent output embedded
    const reviewTaskId = crypto.randomUUID();
    const reviewTaskNow = new Date().toISOString();

    await humanTaskRepo.create({
      id: reviewTaskId,
      processInstanceId: instanceId,
      stepId,
      assignedRole: stepConfig.allowedRoles?.[0] ?? 'reviewer',
      assignedUserId: null,
      status: 'pending',
      deadline: null,
      createdAt: reviewTaskNow,
      updatedAt: reviewTaskNow,
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
          gitMetadata: runResult.envelope?.gitMetadata ?? null,
        },
        iterationNumber: 0,
      },
      creationReason: 'agent_review_l3',
    });

    await auditRepo.append({
      actorId: `agent:${pluginId}`,
      actorType: 'agent',
      actorRole: autonomyLevel,
      action: 'task.created',
      description: `Human task created for step '${stepId}' (reason: agent_review_l3)`,
      timestamp: reviewTaskNow,
      inputSnapshot: { taskId: reviewTaskId, stepId, reason: 'agent_review_l3', assignedRole: stepConfig.allowedRoles?.[0] ?? 'reviewer' },
      outputSnapshot: {},
      basis: 'L3 agent step paused — human reviewer task created',
      entityType: 'humanTask',
      entityId: reviewTaskId,
      processInstanceId: instanceId,
      stepId,
      processDefinitionVersion: instance.definitionVersion,
      executorType: 'agent',
      reviewerType: 'human',
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
  // Guard: do not advance if result is null/empty — indicates a failed execution
  if (runResult.appliedToWorkflow) {
    const stepResult = runResult.envelope?.result;
    if (stepResult === null || stepResult === undefined) {
      throw new Error(
        `Step '${stepId}' completed with null result — cannot advance. ` +
        `Reason: ${runResult.fallbackReason ?? runResult.envelope?.reasoning_summary ?? 'unknown'}`,
      );
    }

    const updatedInstance = await engine.advanceStep(
      instanceId,
      stepResult,
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
