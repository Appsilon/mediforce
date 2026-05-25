import type {
  AgentRun,
  AgentRunRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

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
}
