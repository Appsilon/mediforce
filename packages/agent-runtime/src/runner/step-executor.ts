import type { StepOutputEnvelope, AgentOutputEnvelope } from '@mediforce/platform-core';
import type { AgentPlugin, WorkflowAgentContext } from '../interfaces/agent-plugin';

export type StepExecutionStatus = 'completed' | 'paused' | 'escalated' | 'failed';

export interface StepExecutionResult {
  /** The run status (completed, paused, escalated, failed) — reflects the
   *  agent/script run outcome, not the workflow instance state. */
  status: StepExecutionStatus;
  envelope: StepOutputEnvelope | AgentOutputEnvelope | null;
  appliedToWorkflow: boolean;
  fallbackReason: 'timeout' | 'low_confidence' | 'error' | null;
  errorMessage?: string | null;
  executorType: 'agent' | 'script';
  /** Instance status + currentStepId as known by the executor at return time.
   *  Avoids a redundant getById in the caller. Null when unknown (caller
   *  should re-fetch). */
  instanceState?: { status: string; currentStepId: string | null };
}

export interface StepExecutorServices {
  auditRepo: StepExecutorAuditRepo;
  instanceRepo: StepExecutorInstanceRepo;
  engine: StepExecutorEngine;
  humanTaskRepo: StepExecutorHumanTaskRepo;
  modelRegistryRepo: StepExecutorModelRegistryRepo;
}

export interface StepExecutorAuditRepo {
  append(event: Record<string, unknown>): Promise<void>;
}

export interface StepExecutorInstanceRepo {
  getById(id: string): Promise<{ status: string; currentStepId: string | null; definitionVersion: string; variables: Record<string, unknown>; totalCostUsd?: number } | null>;
  update(id: string, data: Record<string, unknown>): Promise<void>;
  updateStepExecution(instanceId: string, executionId: string, data: Record<string, unknown>): Promise<void>;
  getStepExecutions(instanceId: string): Promise<Array<{ stepId: string; output: unknown }>>;
}

export interface StepExecutorEngine {
  advanceStep(
    instanceId: string,
    stepResult: unknown,
    actor: { id: string; role: string },
    options?: unknown,
    agentRunResult?: unknown,
  ): Promise<{ status: string; currentStepId: string | null }>;
  submitReviewVerdict(
    instanceId: string,
    stepId: string,
    verdict: Record<string, unknown>,
    actor: { id: string; role: string },
  ): Promise<{ status: string; currentStepId: string | null; pauseReason?: string }>;
}

export interface StepExecutorHumanTaskRepo {
  create(task: Record<string, unknown>): Promise<void>;
}

export interface StepExecutorModelRegistryRepo {
  getById(id: string): Promise<{ pricing: { input: number; output: number; cacheRead?: number } } | null>;
}

export interface StepExecutor {
  execute(
    plugin: AgentPlugin,
    context: WorkflowAgentContext,
    services: StepExecutorServices,
    meta: StepExecutorMeta,
  ): Promise<StepExecutionResult>;
}

export interface StepExecutorMeta {
  instanceId: string;
  stepId: string;
  pluginId: string;
  triggeredBy: string;
  stepExecutionId?: string;
  definitionVersion: string;
}
