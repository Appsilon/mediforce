import type {
  ProcessInstanceRepository,
  ProcessInstance,
  InstanceStatus,
  StepExecution,
} from '../index.js';

/**
 * In-memory implementation of ProcessInstanceRepository for testing.
 * Uses Maps for instances and step execution subcollections.
 * Reusable by any package that needs test doubles for process instance operations.
 */
export class InMemoryProcessInstanceRepository
  implements ProcessInstanceRepository
{
  private instances = new Map<string, ProcessInstance>();
  private stepExecutions = new Map<string, StepExecution[]>();

  async create(instance: ProcessInstance): Promise<ProcessInstance> {
    this.instances.set(instance.id, { ...instance });
    return { ...instance };
  }

  async getById(instanceId: string): Promise<ProcessInstance | null> {
    const instance = this.instances.get(instanceId);
    return instance ? { ...instance } : null;
  }

  async update(
    instanceId: string,
    updates: Partial<ProcessInstance>,
  ): Promise<void> {
    const existing = this.instances.get(instanceId);
    if (!existing) {
      throw new Error(`ProcessInstance not found: ${instanceId}`);
    }
    this.instances.set(instanceId, { ...existing, ...updates });
  }

  async getByStatus(status: InstanceStatus): Promise<ProcessInstance[]> {
    return [...this.instances.values()].filter((i) => i.status === status);
  }

  async getByDefinition(
    name: string,
    version: string,
  ): Promise<ProcessInstance[]> {
    return [...this.instances.values()].filter(
      (i) => i.definitionName === name && i.definitionVersion === version,
    );
  }

  async addStepExecution(
    instanceId: string,
    execution: StepExecution,
  ): Promise<StepExecution> {
    const executions = this.stepExecutions.get(instanceId) ?? [];
    executions.push({ ...execution });
    this.stepExecutions.set(instanceId, executions);
    return { ...execution };
  }

  async getStepExecutions(instanceId: string): Promise<StepExecution[]> {
    const executions = this.stepExecutions.get(instanceId) ?? [];
    return [...executions].sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
  }

  async updateStepExecution(
    instanceId: string,
    executionId: string,
    updates: Partial<StepExecution>,
  ): Promise<void> {
    const executions = this.stepExecutions.get(instanceId) ?? [];
    const index = executions.findIndex((e) => e.id === executionId);
    if (index === -1) {
      throw new Error(`StepExecution not found: ${executionId}`);
    }
    executions[index] = { ...executions[index], ...updates };
  }

  async getLatestStepExecution(
    instanceId: string,
    stepId: string,
  ): Promise<StepExecution | null> {
    const executions = this.stepExecutions.get(instanceId) ?? [];
    const matching = executions.filter((e) => e.stepId === stepId);
    if (matching.length === 0) return null;
    return {
      ...matching.sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      )[matching.length - 1],
    };
  }

  async getIdsByDefinitionName(_name: string): Promise<string[]> {
    return [];
  }

  async setDeletedByDefinitionName(_name: string, _deleted: boolean): Promise<void> {
    // No-op in test double — Firestore uses untyped updateDoc for the `deleted` field
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.instances.clear();
    this.stepExecutions.clear();
  }

  /** Test helper: return all instances */
  getAll(): ProcessInstance[] {
    return [...this.instances.values()];
  }

  /** Test helper: return all step executions for an instance */
  getAllStepExecutions(instanceId: string): StepExecution[] {
    return [...(this.stepExecutions.get(instanceId) ?? [])];
  }
}
