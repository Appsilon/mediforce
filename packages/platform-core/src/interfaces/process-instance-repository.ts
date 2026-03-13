import type { ProcessInstance } from '../schemas/process-instance.js';
import type { StepExecution } from '../schemas/step-execution.js';
import type { InstanceStatus } from '../schemas/process-instance.js';

export interface ProcessInstanceRepository {
  create(instance: ProcessInstance): Promise<ProcessInstance>;
  getById(instanceId: string): Promise<ProcessInstance | null>;
  update(instanceId: string, updates: Partial<ProcessInstance>): Promise<void>;
  getByStatus(status: InstanceStatus): Promise<ProcessInstance[]>;
  getByDefinition(name: string, version: string): Promise<ProcessInstance[]>;

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
}
