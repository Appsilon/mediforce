import type {
  AgentRun,
  AgentRunRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace-scoped agent-run reads. AgentRun has no namespace field;
 * membership is reached via the parent `ProcessInstance`.
 */
export class AuthorizedAgentRunRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentRunRepository,
    private readonly parents: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getById = async (runId: string): Promise<AgentRun | null> => {
    const run = await this.raw.getById(runId);
    if (run === null) return null;
    if (this.caller.isSystemActor) return run;
    const parent = await this.parents.getById(run.processInstanceId);
    return this.canSeeNamespace(parent?.namespace) ? run : null;
  };

  getByInstanceId = async (instanceId: string): Promise<AgentRun[]> => {
    const parent = await this.parents.getById(instanceId);
    if (!this.canSeeNamespace(parent?.namespace)) return [];
    return this.raw.getByInstanceId(instanceId);
  };
}
