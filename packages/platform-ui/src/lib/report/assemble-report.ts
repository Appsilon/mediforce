import type {
  ProcessInstance,
  StepExecution,
  AuditEvent,
  Step,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import type { PlatformServices } from '../platform-services.js';
import {
  formatDuration,
  computeWallClockDuration,
  computeActiveProcessingTime,
} from '../format.js';

export interface ReportStep {
  stepId: string;
  name: string;
  type: string;
  status: 'completed' | 'running' | 'pending' | 'failed' | 'escalated' | 'paused';
  executorType: 'human' | 'agent' | 'script' | 'unknown';
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  agentOutput: StepExecution['agentOutput'] | null;
  reviewVerdicts: StepExecution['reviewVerdicts'];
  auditEvents: Array<AuditEvent & { id: string }>;
}

export interface ReportSummary {
  status: string;
  wallClockDuration: string | null;
  wallClockDurationMs: number | null;
  activeProcessingTime: string;
  activeProcessingTimeMs: number;
  completedSteps: number;
  totalSteps: number;
  currentStepId: string | null;
  createdAt: string;
  createdBy: string;
  triggerType: string;
}

export interface RunReportData {
  instance: ProcessInstance;
  definitionName: string;
  definitionVersion: string;
  summary: ReportSummary;
  steps: ReportStep[];
  auditEvents: Array<AuditEvent & { id: string }>;
}

/**
 * Resolve definition steps from either workflow definitions or legacy process definitions.
 * Server-side equivalent of resolve-definition-steps.ts (which needs client hooks).
 */
async function resolveSteps(
  instance: ProcessInstance,
  processRepo: PlatformServices['processRepo'],
): Promise<Step[]> {
  const defVersion = instance.definitionVersion;
  const isNewStyle = /^\d+$/.test(defVersion);

  if (isNewStyle) {
    const versionNum = parseInt(defVersion, 10);
    const workflow = await processRepo.getWorkflowDefinition(
      instance.definitionName,
      versionNum,
    );
    if (workflow?.steps?.length) return workflow.steps;
  }

  // Fallback to legacy
  const legacy = await processRepo.getProcessDefinition(
    instance.definitionName,
    defVersion,
  );
  if (legacy?.steps?.length) return legacy.steps;

  return [];
}

export async function assembleReport(
  instanceId: string,
  services: PlatformServices,
): Promise<RunReportData> {
  const { instanceRepo, processRepo, auditRepo } = services;

  const instance = await instanceRepo.getById(instanceId);
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  const [stepExecutions, allAuditEvents, definitionSteps] = await Promise.all([
    instanceRepo.getStepExecutions(instanceId),
    auditRepo.getByProcess(instanceId),
    resolveSteps(instance, processRepo),
  ]);

  // Index audit events by id (Firestore returns them with id)
  const auditWithIds = allAuditEvents.map((event, index) => ({
    ...event,
    id: `audit-${index}`,
  }));

  // Index executions by stepId (latest per step)
  const executionsByStep = new Map<string, StepExecution>();
  for (const exec of stepExecutions) {
    const existing = executionsByStep.get(exec.stepId);
    if (!existing || exec.startedAt > existing.startedAt) {
      executionsByStep.set(exec.stepId, exec);
    }
  }

  // Determine step configs for executor type
  let stepConfigs: Array<{ stepId: string; executorType?: string }> = [];
  const isNewStyle = /^\d+$/.test(instance.definitionVersion);
  if (!isNewStyle) {
    const config = await processRepo.getProcessConfig(
      instance.definitionName,
      instance.configName ?? '',
      instance.configVersion ?? '',
    );
    stepConfigs = config?.stepConfigs ?? [];
  }

  // Build report steps
  const currentStepId = instance.currentStepId;
  let pastCurrentStep = false;
  const reportSteps: ReportStep[] = [];

  for (const step of definitionSteps) {
    if (step.type === 'terminal') continue;

    const execution = executionsByStep.get(step.id) ?? null;

    // Determine executor type — new-style has it on the step, legacy on config
    let executorType: ReportStep['executorType'] = 'unknown';
    if ('executor' in step && step.executor) {
      executorType = step.executor as ReportStep['executorType'];
    } else {
      const stepConfig = stepConfigs.find((sc) => sc.stepId === step.id);
      executorType = (stepConfig?.executorType as ReportStep['executorType']) ?? 'unknown';
    }

    // Determine status
    let status: ReportStep['status'];
    if (execution?.status === 'failed') {
      status = 'failed';
    } else if (execution?.status === 'escalated') {
      status = 'escalated';
    } else if (execution?.status === 'paused') {
      status = 'paused';
    } else if (pastCurrentStep) {
      status = 'pending';
    } else if (step.id === currentStepId) {
      status = instance.status === 'completed' ? 'completed' : 'running';
      pastCurrentStep = true;
    } else if (instance.status === 'completed' && currentStepId === null) {
      status = execution?.output !== null ? 'completed' : 'pending';
    } else {
      const hasOutput = execution?.output !== null;
      status = hasOutput ? 'completed' : 'pending';
    }

    // Duration
    let durationMs: number | null = null;
    if (execution?.completedAt !== null && execution?.startedAt) {
      durationMs =
        new Date(execution.completedAt).getTime() -
        new Date(execution.startedAt).getTime();
    }

    // Audit events for this step
    const stepAudit = auditWithIds
      .filter((e) => e.stepId === step.id)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

    reportSteps.push({
      stepId: step.id,
      name: step.name,
      type: step.type,
      status,
      executorType,
      startedAt: execution?.startedAt ?? null,
      completedAt: execution?.completedAt ?? null,
      durationMs,
      input: execution?.input ?? {},
      output: execution?.output ?? null,
      error: execution?.error ?? null,
      agentOutput: execution?.agentOutput ?? null,
      reviewVerdicts: execution?.reviewVerdicts,
      auditEvents: stepAudit,
    });
  }

  // Summary
  const wallClockMs = computeWallClockDuration(
    instance.createdAt,
    stepExecutions,
  );
  const activeMs = computeActiveProcessingTime(stepExecutions);

  const summary: ReportSummary = {
    status: instance.status,
    wallClockDuration: wallClockMs !== null ? formatDuration(wallClockMs) : null,
    wallClockDurationMs: wallClockMs,
    activeProcessingTime: formatDuration(activeMs),
    activeProcessingTimeMs: activeMs,
    completedSteps: reportSteps.filter((s) => s.status === 'completed').length,
    totalSteps: reportSteps.length,
    currentStepId,
    createdAt: instance.createdAt,
    createdBy: instance.createdBy,
    triggerType: instance.triggerType,
  };

  return {
    instance,
    definitionName: instance.definitionName,
    definitionVersion: instance.definitionVersion,
    summary,
    steps: reportSteps,
    auditEvents: auditWithIds,
  };
}
