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
 * The wrapper is a router. For each read it dispatches to either the
 * `*All` variant (system actor) or the `*InNamespaces` variant (user caller);
 * the storage layer enforces the namespace filter. Out-of-scope rows surface
 * as null (single) or absent (list).
 */
export class AuthorizedWorkflowRunRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getById = async (id: string): Promise<ProcessInstance | null> =>
    this.caller.isSystemActor
      ? this.raw.getById(id)
      : this.raw.getByIdInNamespaces(id, [...this.caller.namespaces]);

  list = async (options: ListInstancesOptions): Promise<ProcessInstance[]> =>
    this.caller.isSystemActor
      ? this.raw.listAll(options)
      : this.raw.listInNamespaces([...this.caller.namespaces], options);

  getByStatus = async (status: InstanceStatus): Promise<ProcessInstance[]> =>
    this.caller.isSystemActor
      ? this.raw.getByStatusAll(status)
      : this.raw.getByStatusInNamespaces(status, [...this.caller.namespaces]);

  getByDefinition = async (name: string, version: string): Promise<ProcessInstance[]> => {
    const all = await this.raw.getByDefinition(name, version);
    if (this.caller.isSystemActor) return all;
    const allowed = this.caller.namespaces;
    return all.filter(
      (run) => typeof run.namespace === 'string' && allowed.has(run.namespace),
    );
  };

  /** Step executions belong to the parent run; gating is on the parent. */
  getStepExecutions = async (id: string): Promise<StepExecution[]> => {
    const run = await this.getById(id);
    if (run === null) return [];
    return this.raw.getStepExecutions(id);
  };

  getLatestStepExecution = async (id: string, stepId: string): Promise<StepExecution | null> => {
    const run = await this.getById(id);
    if (run === null) return null;
    return this.raw.getLatestStepExecution(id, stepId);
  };

  /** Update is workspace-gated through `getById`. Callers must look up first. */
  update = async (id: string, updates: Partial<ProcessInstance>): Promise<void> => {
    const existing = await this.getById(id);
    if (existing === null) {
      throw new ForbiddenError();
    }
    await this.raw.update(id, updates);
  };
}
