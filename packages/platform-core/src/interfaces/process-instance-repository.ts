import type { ProcessInstance } from '../schemas/process-instance.js';
import type { StepExecution } from '../schemas/step-execution.js';
import type { InstanceStatus } from '../schemas/process-instance.js';

export interface ListInstancesOptions {
  definitionName?: string;
  status?: InstanceStatus;
  namespace?: string;
  limit?: number;
}

export interface ProcessInstanceRepository {
  create(instance: ProcessInstance): Promise<ProcessInstance>;
  getById(instanceId: string): Promise<ProcessInstance | null>;
  update(instanceId: string, updates: Partial<ProcessInstance>): Promise<void>;
  list(options: ListInstancesOptions): Promise<ProcessInstance[]>;
  getByStatus(status: InstanceStatus): Promise<ProcessInstance[]>;
  getByDefinition(name: string, version: string): Promise<ProcessInstance[]>;
  /**
   * Most recently completed run of a workflow (by name, across versions),
   * ordered by updatedAt desc. Used by the previous-run-outputs resolver to
   * find the predecessor whose outputs feed `ProcessInstance.previousRun`.
   */
  getLastCompletedByDefinitionName(name: string): Promise<ProcessInstance | null>;

  // Step execution subcollection
  addStepExecution(
    instanceId: string,
    execution: StepExecution,
  ): Promise<StepExecution>;
  getStepExecutions(instanceId: string): Promise<StepExecution[]>;
  getLatestStepExecution(
    instanceId: string,
    stepId: string,
  ): Promise<StepExecution | null>;
  updateStepExecution(
    instanceId: string,
    executionId: string,
    updates: Partial<StepExecution>,
  ): Promise<void>;

  getIdsByDefinitionName(name: string): Promise<string[]>;
  setDeletedByDefinitionName(name: string, deleted: boolean): Promise<void>;
}
