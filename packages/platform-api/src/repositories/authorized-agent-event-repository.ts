import type {
  AgentEvent,
  AgentEventRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped agent-event reads. Events have no workspace field; the
 * raw repo resolves namespace via the parent `ProcessInstance`. Out-of-scope
 * or missing parent yields an empty list — handlers surface that as 404 when
 * the parent lookup is the access decision.
 *
 * Read-only — the write side lives in `agent-runtime`
 * (`FirestoreAgentEventLog`) which still embeds its own Firestore writes
 * plus an in-memory cache. Unifying write+read behind one repository is
 * tracked as post-phase-4 follow-up.
 */
export class AuthorizedAgentEventRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentEventRepository,
  ) {
    super(caller);
  }

  listByInstance = async (
    instanceId: string,
    afterSequence?: number,
  ): Promise<AgentEvent[]> =>
    this.caller.isSystemActor
      ? this.raw.listByInstance(instanceId, afterSequence)
      : this.raw.listByInstanceInNamespaces(
          instanceId,
          [...this.caller.namespaces],
          afterSequence,
        );

  listByStep = async (
    instanceId: string,
    stepId: string,
    afterSequence?: number,
  ): Promise<AgentEvent[]> =>
    this.caller.isSystemActor
      ? this.raw.listByStep(instanceId, stepId, afterSequence)
      : this.raw.listByStepInNamespaces(
          instanceId,
          stepId,
          [...this.caller.namespaces],
          afterSequence,
        );
}
