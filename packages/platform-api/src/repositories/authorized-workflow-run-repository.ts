import type {
  ProcessInstance,
  ProcessInstanceRepository,
  StepExecution,
  InstanceStatus,
} from '@mediforce/platform-core';
import type { ListInstancesOptions } from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedRepository } from './authorized-repository.js';

/**
 * Workspace-scoped view of `ProcessInstanceRepository`.
 *
 * Canonical naming: the wrapper interface uses `WorkflowRun` per ADR-0001's
 * vocabulary; the raw repo retains `ProcessInstance*` until the storage-level
 * rename lands with the Postgres migration.
 *
 * Reads enforce caller workspace membership: `getById` returns null for
 * out-of-scope rows, `list` and `getByStatus` filter them out. Writes enforce
 * workspace at construction time of the created entity (user callers cannot
 * create runs outside their namespaces; apiKey callers are unrestricted).
 */
export interface AuthorizedWorkflowRunRepository {
  getById(id: string): Promise<ProcessInstance | null>;
  list(options: ListInstancesOptions): Promise<ProcessInstance[]>;
  getByStatus(status: InstanceStatus): Promise<ProcessInstance[]>;
  getByDefinition(name: string, version: string): Promise<ProcessInstance[]>;
  getStepExecutions(id: string): Promise<StepExecution[]>;
  getLatestStepExecution(id: string, stepId: string): Promise<StepExecution | null>;
}

export class AuthorizedWorkflowRunRepositoryImpl
  extends AuthorizedRepository<ProcessInstance>
  implements AuthorizedWorkflowRunRepository
{
  constructor(
    caller: CallerIdentity,
    private readonly raw: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getById = async (id: string): Promise<ProcessInstance | null> =>
    this.gate(await this.raw.getById(id));

  list = async (options: ListInstancesOptions): Promise<ProcessInstance[]> =>
    this.filter(await this.raw.list(options));

  getByStatus = async (status: InstanceStatus): Promise<ProcessInstance[]> =>
    this.filter(await this.raw.getByStatus(status));

  getByDefinition = async (name: string, version: string): Promise<ProcessInstance[]> =>
    this.filter(await this.raw.getByDefinition(name, version));

  /** Step executions belong to the parent run; gating is on the parent. */
  getStepExecutions = async (id: string): Promise<StepExecution[]> => {
    const run = await this.raw.getById(id);
    if (!this.canSee(run)) return [];
    return this.raw.getStepExecutions(id);
  };

  getLatestStepExecution = async (id: string, stepId: string): Promise<StepExecution | null> => {
    const run = await this.raw.getById(id);
    if (!this.canSee(run)) return null;
    return this.raw.getLatestStepExecution(id, stepId);
  };

  /** Update is workspace-gated through `getById`. Callers must look up first. */
  update = async (id: string, updates: Partial<ProcessInstance>): Promise<void> => {
    const existing = await this.raw.getById(id);
    if (!this.canSee(existing)) throw new ForbiddenError();
    await this.raw.update(id, updates);
  };
}
