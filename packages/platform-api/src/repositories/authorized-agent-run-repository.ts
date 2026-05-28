import type {
  AgentRun,
  AgentRunRepository,
  ListAgentRunsOptions,
  ListAgentRunsPage,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';
import { ForbiddenError } from '../errors.js';

/**
 * Workspace-scoped agent-run reads. AgentRun has no namespace field;
 * membership is reached via the parent `ProcessInstance` inside the raw repo.
 */
export class AuthorizedAgentRunRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentRunRepository,
  ) {
    super(caller);
  }

  getById = async (runId: string): Promise<AgentRun | null> =>
    this.caller.isSystemActor
      ? this.raw.getById(runId)
      : this.raw.getByIdInNamespaces(runId, [...this.caller.namespaces]);

  getByInstanceId = async (instanceId: string): Promise<AgentRun[]> =>
    this.caller.isSystemActor
      ? this.raw.getByInstanceId(instanceId)
      : this.raw.getByInstanceIdInNamespaces(instanceId, [...this.caller.namespaces]);

  list = async (opts: ListAgentRunsOptions): Promise<ListAgentRunsPage> => {
    if (this.caller.isSystemActor) return this.raw.list(opts);
    const allowed = opts.namespace !== undefined
      ? this.narrow(opts.namespace)
      : [...this.caller.namespaces];
    return this.raw.listInNamespaces(allowed, opts);
  };

  /**
   * Intersection of an explicit `?namespace=` filter with the caller's
   * memberships. Reaching into a workspace the caller doesn't belong to is
   * the standard anti-enum 404: surface as `ForbiddenError`, route adapter
   * maps to 403.
   */
  private narrow(requested: string): string[] {
    if (!this.caller.namespaces.has(requested)) {
      throw new ForbiddenError(`Not a member of workspace '${requested}'`);
    }
    return [requested];
  }
}
