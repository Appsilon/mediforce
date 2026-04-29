// Workflow-native agent step executor.
// Reads executor type, plugin, autonomy level, and all step settings directly
// from WorkflowStep — no separate ProcessConfig required.
//
// This is the WorkflowDefinition counterpart to execute-agent-step.ts (legacy ProcessConfig path).
// Called by the auto-runner loop when the instance was created via fireWorkflow (no configName).

import { getPlatformServices } from './platform-services';
import {
  resolveMcpForStep,
  resolveOAuthToken,
  OAuthTokenUnavailableError,
  type ResolvedOAuthBinding,
  type WorkflowAgentContext,
} from '@mediforce/agent-runtime';
import type {
  AgentOAuthTokenRepository,
  OAuthProviderRepository,
  ResolvedMcpConfig,
  WorkflowDefinition,
  WorkflowStep,
} from '@mediforce/platform-core';
import { getWorkflowSecretsForRuntime } from '../app/actions/workflow-secrets';

export interface WorkflowAgentStepResult {
  instanceId: string;
  status: string;
  currentStepId: string | null;
  agentRunStatus: string;
}

/**
 * Execute a single agent/script step for a WorkflowDefinition instance.
 *
 * All configuration (executor, plugin, autonomyLevel, params, env) comes from
 * the WorkflowStep embedded in the WorkflowDefinition — no ProcessConfig needed.
 */
export async function executeAgentStep(
  instanceId: string,
  stepId: string,
  workflowStep: WorkflowStep,
  appContext: Record<string, unknown>,
  triggeredBy: string,
  stepExecutionId?: string,
): Promise<WorkflowAgentStepResult> {
  const {
    engine,
    agentRunner,
    pluginRegistry,
    instanceRepo,
    processRepo,
    auditRepo,
    humanTaskRepo,
    llmClient,
    agentDefinitionRepo,
    toolCatalogRepo,
    oauthProviderRepo,
    agentOAuthTokenRepo,
  } = getPlatformServices();

  const instance = await instanceRepo.getById(instanceId);
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  // Load the full WorkflowDefinition for WorkflowAgentContext
  const workflowDefinition: WorkflowDefinition | null = await processRepo.getWorkflowDefinition(
    instance.definitionName,
    Number(instance.definitionVersion),
  );
  if (!workflowDefinition) {
    throw new Error(
      `WorkflowDefinition not found: ${instance.definitionName} v${instance.definitionVersion}`,
    );
  }

  // Resolve plugin: use workflowStep.plugin when set, fall back to stepId
  const pluginId = workflowStep.plugin ?? stepId;
  const plugin = pluginRegistry.get(pluginId);

  // Resolve autonomy level from step (script steps are always L4)
  const autonomyLevel = workflowStep.executor === 'script'
    ? 'L4'
    : (workflowStep.autonomyLevel ?? 'L2');

  // Merge step params into context — stepParams take lower priority than appContext
  const mergedInput: Record<string, unknown> = {
    ...(workflowStep.stepParams ?? {}),
    ...appContext,
  };

  await auditRepo.append({
    actorId: `agent:${pluginId}`,
    actorType: 'agent',
    actorRole: autonomyLevel,
    action: 'agent.step.started',
    description: `Workflow agent step '${stepId}' started (plugin: ${pluginId}, autonomy: ${autonomyLevel})`,
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

  // Pre-fetch workflow secrets for {{TEMPLATE}} resolution
  const workflowSecrets = await getWorkflowSecretsForRuntime(
    workflowDefinition.namespace,
    workflowDefinition.name,
  );

  // Pre-resolve MCP configuration from the agent definition + step restrictions
  // + tool catalog. undefined when step.agentId is unset. Namespace-scoped
  // catalog lookups use the workflow's namespace.
  const resolvedMcpConfig = (await resolveMcpForStep(workflowStep, {
    agentDefinitionRepo,
    toolCatalogRepo,
    namespace: workflowDefinition.namespace,
  })) ?? undefined;

  // Load and (lazily) refresh OAuth tokens for every HTTP binding that
  // requested OAuth auth. Done here, not in the runtime, so the runtime
  // stays decoupled from Firestore — queued-docker-spawn can serialize
  // the context over BullMQ once this is populated. Refresh failures
  // bubble up with actionable errors ("Reconnect via UI").
  const oauthTokens = workflowStep.agentId !== undefined && resolvedMcpConfig !== undefined
    ? await loadOAuthTokens({
        namespace: workflowDefinition.namespace,
        agentId: workflowStep.agentId,
        resolvedMcpConfig,
        oauthProviderRepo,
        agentOAuthTokenRepo,
      })
    : undefined;

  const workflowAgentContext: WorkflowAgentContext = {
    stepId,
    processInstanceId: instanceId,
    definitionVersion: instance.definitionVersion,
    stepInput: mergedInput,
    autonomyLevel,
    workflowDefinition,
    step: workflowStep,
    llm: llmClient,
    workflowSecrets,
    resolvedMcpConfig,
    ...(instance.previousRun !== undefined
      ? { previousRun: instance.previousRun }
      : {}),
    oauthTokens,
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

  const runResult = await agentRunner.runWithWorkflowStep(plugin, workflowAgentContext);

  // Persist agent output to step execution
  const envelope = runResult.envelope;
  if (stepExecutionId) {
    const isFailed = runResult.fallbackReason === 'error' || runResult.fallbackReason === 'timeout';
    // L3 + escalated (non-error) routes to human review below, so the execution
    // is not a failure — the run produced a usable envelope, just flagged for review.
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
          }
        : null,
    });
  }

  // When the agent crashes (fallbackReason='error'), surface the error on the
  // run overview by writing it to processInstance.error. Without this the error
  // is only visible on the step detail page.
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

  // Persist output to instance.variables so subsequent steps can read it
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

  // Create a human review task for an L3 step, append audit, pause instance.
  // Used for: (a) paused/escalated agent run, (b) agent reviewer returned no
  // verdict, (c) agent reviewer exhausted the iteration limit.
  const createAgentReviewHumanTask = async (
    escalationReason: 'low_confidence' | 'timeout' | 'error' | 'iterations_limit' | null,
    auditBasis: string,
  ): Promise<void> => {
    const reviewTaskId = crypto.randomUUID();
    const reviewTaskNow = new Date().toISOString();
    const assignedRole = workflowStep.allowedRoles?.[0] ?? 'reviewer';

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
        iterationNumber: 0,
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
      processDefinitionVersion: instance.definitionVersion,
      executorType: 'agent',
      reviewerType: 'human',
    });

    await instanceRepo.update(instanceId, {
      status: 'paused',
      pauseReason: 'waiting_for_human',
      updatedAt: new Date().toISOString(),
    });
  };

  // ---- L3 Review Routing (skip when agent errored — nothing to review) ----
  // Escalation from fallback handler (status='escalated') always needs a human,
  // even when review.type='agent' — the whole point of escalate_to_human is that
  // the agent couldn't self-resolve.
  if ((runResult.status === 'paused' || runResult.status === 'escalated') && autonomyLevel === 'L3' && runResult.fallbackReason !== 'error') {
    const reviewerType = workflowStep.review?.type ?? 'human';
    const isEscalation = runResult.status === 'escalated';

    if (reviewerType === 'human' || reviewerType === 'none' || isEscalation) {
      await createAgentReviewHumanTask(
        isEscalation ? runResult.fallbackReason : null,
        'L3 workflow agent step paused — human reviewer task created',
      );
      return {
        instanceId,
        status: 'paused',
        currentStepId: stepId,
        agentRunStatus: runResult.status,
      };
    }
  }

  // ---- L3 Agent-as-Reviewer: submit verdict via engine.submitReviewVerdict ----
  // review.type='agent' on a review step: the agent's verdict flows through
  // ReviewTracker so iteration counting and maxIterations enforcement fire.
  // On verdict='revise' the step routes back to a prior creation step; when
  // iterations are exhausted, the engine pauses with max_iterations_exceeded
  // and we create a human escalation task so the process stays actionable.
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
        instanceId,
        status: 'paused',
        currentStepId: stepId,
        agentRunStatus: 'escalated',
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
        instanceId,
        status: 'paused',
        currentStepId: stepId,
        agentRunStatus: 'escalated',
      };
    }

    return {
      instanceId,
      status: updated.status,
      currentStepId: updated.currentStepId,
      agentRunStatus: 'completed',
    };
  }

  // ---- Escalation/Pause (non-L3) ----
  if (runResult.status === 'escalated' || runResult.status === 'paused') {
    await auditRepo.append({
      actorId: `agent:${pluginId}`,
      actorType: 'agent',
      actorRole: autonomyLevel,
      action: 'agent.escalated',
      description: `Workflow step '${stepId}' escalated — reason: ${runResult.fallbackReason ?? 'unknown'}`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { stepId, fallbackReason: runResult.fallbackReason ?? null },
      outputSnapshot: { status: runResult.status },
      basis: 'FallbackHandler: agent could not complete step autonomously',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      stepId,
      processDefinitionVersion: instance.definitionVersion,
      executorType: 'agent',
      reviewerType: 'none',
    });
    const currentInstance = await instanceRepo.getById(instanceId);
    return {
      instanceId,
      status: currentInstance?.status ?? 'paused',
      currentStepId: currentInstance?.currentStepId ?? null,
      agentRunStatus: runResult.status,
    };
  }

  // L4: appliedToWorkflow=true — advance the step using WorkflowEngine
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
      instanceId,
      status: updatedInstance.status,
      currentStepId: updatedInstance.currentStepId,
      agentRunStatus: runResult.status,
    };
  }

  // L0/L1/L2: agent completed but didn't auto-apply — advance to next step.
  // If the next step is human, advanceStep creates a HumanTask and pauses.
  if (runResult.status === 'completed') {
    const stepResult = runResult.envelope?.result ?? {};
    const updatedInstance = await engine.advanceStep(
      instanceId,
      stepResult,
      { id: triggeredBy, role: 'agent' },
      undefined,
    );

    return {
      instanceId,
      status: updatedInstance.status,
      currentStepId: updatedInstance.currentStepId,
      agentRunStatus: runResult.status,
    };
  }

  // Fallback: unknown status — return current state (should not reach here)
  const currentInstance = await instanceRepo.getById(instanceId);
  return {
    instanceId,
    status: currentInstance?.status ?? instance.status,
    currentStepId: currentInstance?.currentStepId ?? instance.currentStepId,
    agentRunStatus: runResult.status,
  };
}

interface LoadOAuthTokensDeps {
  namespace: string;
  agentId: string;
  resolvedMcpConfig: ResolvedMcpConfig;
  oauthProviderRepo: OAuthProviderRepository;
  agentOAuthTokenRepo: AgentOAuthTokenRepository;
}

/** Load and lazy-refresh OAuth tokens for every HTTP binding in the
 *  resolved MCP config whose auth is `type: 'oauth'`. Each token is
 *  refreshed in place (Firestore write) when near expiry before its
 *  accessToken flows into the runtime context. Callers forward refresh
 *  errors up — the workflow then fails with an actionable "Reconnect"
 *  message surfaced in the UI. Returns undefined when no OAuth bindings
 *  are present (so the context field stays absent, not an empty object). */
async function loadOAuthTokens(
  deps: LoadOAuthTokensDeps,
): Promise<Record<string, ResolvedOAuthBinding> | undefined> {
  const { namespace, agentId, resolvedMcpConfig, oauthProviderRepo, agentOAuthTokenRepo } = deps;
  const result: Record<string, ResolvedOAuthBinding> = {};

  for (const [serverName, server] of Object.entries(resolvedMcpConfig.servers)) {
    if (server.type !== 'http' || server.auth?.type !== 'oauth') continue;
    const auth = server.auth;

    const providerId = auth.provider;
    const [token, provider] = await Promise.all([
      agentOAuthTokenRepo.get(namespace, agentId, serverName),
      oauthProviderRepo.get(namespace, providerId),
    ]);

    if (token === null) {
      throw new OAuthTokenUnavailableError(serverName, providerId);
    }
    if (provider === null) {
      throw new Error(
        `OAuth provider "${providerId}" (referenced by MCP server "${serverName}") not found in ` +
        `namespace "${namespace}". Recreate the provider in the admin OAuth Providers page, ` +
        `or switch the binding to a different provider.`,
      );
    }

    const { token: fresh, wasRefreshed } = await resolveOAuthToken({ token, provider });
    if (wasRefreshed) {
      await agentOAuthTokenRepo.put(namespace, agentId, serverName, fresh);
    }

    result[serverName] = {
      accessToken: fresh.accessToken,
      headerName: auth.headerName,
      headerValueTemplate: auth.headerValueTemplate,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
