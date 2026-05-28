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
    // Narrow the caller's memberships down to a single workspace when the
    // request asks for one explicitly. Reaching into a workspace the caller
    // doesn't belong to surfaces as `ForbiddenError` (403), not an empty
    // list — empty would be indistinguishable from "no runs here".
    const memberships = this.caller.namespaces;
    let allowed: string[];
    if (opts.namespace !== undefined) {
      if (!memberships.has(opts.namespace)) {
        throw new ForbiddenError(`Not a member of workspace '${opts.namespace}'`);
      }
      allowed = [opts.namespace];
    } else {
      allowed = [...memberships];
    }
    return this.raw.listInNamespaces(allowed, opts);
  };
}
