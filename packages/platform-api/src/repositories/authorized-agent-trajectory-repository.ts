import type {
  AgentTrajectoryReadOptions,
  AgentTrajectoryRepository,
  StoredAgentTrajectoryEntry,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Agent Trajectory reads, scoped through the parent Agent Run's workspace.
 * `null` — unknown run or one outside the caller's workspaces — is what a
 * handler turns into 404. Read-only: the runner writes through the raw repo.
 */
export class AuthorizedAgentTrajectoryRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentTrajectoryRepository,
  ) {
    super(caller);
  }

  list = async (
    agentRunId: string,
    options: AgentTrajectoryReadOptions = {},
  ): Promise<StoredAgentTrajectoryEntry[] | null> =>
    this.caller.isSystemActor
      ? this.raw.list(agentRunId, options)
      : this.raw.listInNamespaces(agentRunId, [...this.caller.namespaces], options);
}
