import type {
  InstanceStatus,
  ProcessInstance,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';

interface StubOptions {
  status?: InstanceStatus;
  evalRunByInstance?: Map<string, string>;
}

/**
 * Stub ProcessInstanceRepository for the parity suites of repositories that
 * resolve a namespace through their parent run. Only `getById` and
 * `getNamespaceById` are invoked; they return a minimal-shape instance with
 * the namespace mapping registered in `nsByInstance`.
 */
export class StubProcessInstanceRepository implements ProcessInstanceRepository {
  private readonly status: InstanceStatus;
  private readonly evalRunByInstance: Map<string, string>;

  constructor(
    private readonly nsByInstance: Map<string, string>,
    options: StubOptions = {},
  ) {
    this.status = options.status ?? 'completed';
    this.evalRunByInstance = options.evalRunByInstance ?? new Map();
  }

  async getNamespaceById(instanceId: string): Promise<string | null> {
    return this.nsByInstance.get(instanceId) ?? null;
  }

  async getById(instanceId: string): Promise<ProcessInstance | null> {
    const namespace = this.nsByInstance.get(instanceId);
    if (namespace === undefined) return null;
    return {
      id: instanceId,
      definitionName: 'stub-def',
      definitionVersion: '1.0.0',
      status: this.status,
      namespace,
      ...(this.evalRunByInstance.has(instanceId) ? { evalRunId: this.evalRunByInstance.get(instanceId) } : {}),
      input: {},
      output: {},
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
    } as unknown as ProcessInstance;
  }

  // Methods unused by the parity contracts — throw if accidentally hit.
  async create(): Promise<ProcessInstance> { throw new Error('stub'); }
  async getByIdInNamespaces(): Promise<ProcessInstance | null> { throw new Error('stub'); }
  async listAll(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async listInNamespaces(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async listDefinitionNames(): Promise<never> { throw new Error('stub'); }
  async getDefinitionPinsAll(): Promise<never[]> { throw new Error('stub'); }
  async getDefinitionPinsInNamespaces(): Promise<never[]> { throw new Error('stub'); }
  async summarizeRunsByWorkflow(): Promise<never> { throw new Error('stub'); }
  async getByStatusAll(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async getByStatusInNamespaces(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async getChildrenAll(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async getChildrenInNamespaces(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async update(): Promise<void> { throw new Error('stub'); }
  async updateIfPaused(): Promise<boolean> { throw new Error('stub'); }
  async getByDefinition(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async getLastCompletedByDefinitionName(): Promise<ProcessInstance | null> { throw new Error('stub'); }
  async addStepExecution(): Promise<never> { throw new Error('stub'); }
  async getStepExecutions(): Promise<never[]> { throw new Error('stub'); }
  async getLatestStepExecution(): Promise<null> { throw new Error('stub'); }
  async updateStepExecution(): Promise<void> { throw new Error('stub'); }
  async getIdsByDefinitionName(): Promise<string[]> { throw new Error('stub'); }
  async setDeletedByDefinitionName(): Promise<void> { throw new Error('stub'); }
  async listPage(): Promise<never> { throw new Error('stub'); }
  async listPageInNamespaces(): Promise<never> { throw new Error('stub'); }
  async countByDisplayStatus(): Promise<never> { throw new Error('stub'); }
  async countByDisplayStatusInNamespaces(): Promise<never> { throw new Error('stub'); }
}
