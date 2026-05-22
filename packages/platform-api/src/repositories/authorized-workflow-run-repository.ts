import type {
  ProcessInstance,
  ProcessInstanceRepository,
  StepExecution,
  InstanceStatus,
} from '@mediforce/platform-core';
import type { ListInstancesOptions } from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedScope } from './authorized-repository.js';

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
export class AuthorizedWorkflowRunRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getById = async (id: string): Promise<ProcessInstance | null> => {
    const run = await this.raw.getById(id);
    return run !== null && this.canSeeNamespace(run.namespace) ? run : null;
  };

  list = async (options: ListInstancesOptions): Promise<ProcessInstance[]> =>
    this.filterByNamespace(await this.raw.list(options));

  getByStatus = async (status: InstanceStatus): Promise<ProcessInstance[]> =>
    this.filterByNamespace(await this.raw.getByStatus(status));

  getByDefinition = async (name: string, version: string): Promise<ProcessInstance[]> =>
    this.filterByNamespace(await this.raw.getByDefinition(name, version));

  /** Step executions belong to the parent run; gating is on the parent. */
  getStepExecutions = async (id: string): Promise<StepExecution[]> => {
    const run = await this.raw.getById(id);
    if (run === null || !this.canSeeNamespace(run.namespace)) return [];
    return this.raw.getStepExecutions(id);
  };

  getLatestStepExecution = async (id: string, stepId: string): Promise<StepExecution | null> => {
    const run = await this.raw.getById(id);
    if (run === null || !this.canSeeNamespace(run.namespace)) return null;
    return this.raw.getLatestStepExecution(id, stepId);
  };

  /** Update is workspace-gated through `getById`. Callers must look up first. */
  update = async (id: string, updates: Partial<ProcessInstance>): Promise<void> => {
    const existing = await this.raw.getById(id);
    if (existing === null || !this.canSeeNamespace(existing.namespace)) {
      throw new ForbiddenError();
    }
    await this.raw.update(id, updates);
  };

  private filterByNamespace(runs: readonly ProcessInstance[]): ProcessInstance[] {
    if (this.caller.kind === 'apiKey') return [...runs];
    return runs.filter((run) => this.canSeeNamespace(run.namespace));
  }
}
