// Workflow-native agent step executor.
// Reads executor type, plugin, autonomy level, and all step settings directly
// from WorkflowStep — no separate ProcessConfig required.
//
// This is the WorkflowDefinition counterpart to execute-agent-step.ts (legacy ProcessConfig path).
// Called by the auto-runner loop when the instance was created via fireWorkflow (no configName).

import { getPlatformServices } from './platform-services';
import type { WorkflowAgentContext } from '@mediforce/agent-runtime';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

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
export async function executeWorkflowAgentStep(
  instanceId: string,
  stepId: string,
  workflowStep: WorkflowStep,
  appContext: Record<string, unknown>,
  triggeredBy: string,
  stepExecutionId?: string,
): Promise<WorkflowAgentStepResult> {
  const { engine, agentRunner, pluginRegistry, instanceRepo, processRepo, auditRepo, humanTaskRepo, llmClient } =
    getPlatformServices();

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

  const workflowAgentContext: WorkflowAgentContext = {
    stepId,
    processInstanceId: instanceId,
    definitionVersion: instance.definitionVersion,
    stepInput: mergedInput,
    autonomyLevel,
    workflowDefinition,
    step: workflowStep,
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

  const runResult = await agentRunner.runWithWorkflowStep(plugin, workflowAgentContext);

  // Persist agent output to step execution
  const envelope = runResult.envelope;
  if (stepExecutionId) {
    await instanceRepo.updateStepExecution(instanceId, stepExecutionId, {
      output: envelope?.result ?? null,
      status: runResult.status === 'completed' || runResult.status === 'paused' ? 'completed' : 'failed',
      completedAt: new Date().toISOString(),
      agentOutput: envelope
        ? {
            confidence: envelope.confidence ?? null,
            reasoning: envelope.reasoning_summary ?? null,
            model: envelope.model ?? null,
            duration_ms: envelope.duration_ms ?? null,
            gitMetadata: envelope.gitMetadata ?? null,
          }
        : null,
    });
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

  // ---- L3 Review Routing ----
  if ((runResult.status === 'paused' || runResult.status === 'escalated') && autonomyLevel === 'L3') {
    const reviewerType = workflowStep.review?.type ?? 'human';

    if (reviewerType === 'human' || reviewerType === 'none') {
      const reviewTaskId = crypto.randomUUID();
      const reviewTaskNow = new Date().toISOString();

      await humanTaskRepo.create({
        id: reviewTaskId,
        processInstanceId: instanceId,
        stepId,
        assignedRole: workflowStep.allowedRoles?.[0] ?? 'reviewer',
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
        description: `Human task created for workflow step '${stepId}' (reason: agent_review_l3)`,
        timestamp: reviewTaskNow,
        inputSnapshot: { taskId: reviewTaskId, stepId, reason: 'agent_review_l3', assignedRole: workflowStep.allowedRoles?.[0] ?? 'reviewer' },
        outputSnapshot: {},
        basis: 'L3 workflow agent step paused — human reviewer task created',
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

    const updatedInstance = await engine.advanceWorkflowStep(
      instanceId,
      stepResult,
      { id: triggeredBy, role: 'agent' },
      workflowStep,
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
