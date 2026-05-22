import type {
  CoworkSession,
  CoworkSessionRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace-scoped cowork sessions. Namespace is reached via the parent
 * `ProcessInstance`. Anti-enumeration: every out-of-scope path collapses
 * to a `null` return — handlers convert to 404 so a non-member cannot
 * distinguish "exists in another namespace" from "doesn't exist at all".
 */
export class AuthorizedCoworkSessionRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: CoworkSessionRepository,
    private readonly parents: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getById = async (sessionId: string): Promise<CoworkSession | null> => {
    const session = await this.raw.getById(sessionId);
    if (session === null) return null;
    if (this.caller.isSystemActor) return session;
    const parent = await this.parents.getById(session.processInstanceId);
    return this.canSeeNamespace(parent?.namespace) ? session : null;
  };

  findMostRecentActiveForInstance = async (instanceId: string): Promise<CoworkSession | null> => {
    if (this.caller.isSystemActor) return this.raw.findMostRecentActive(instanceId);
    const parent = await this.parents.getById(instanceId);
    if (parent === null) return null;
    if (!this.canSeeNamespace(parent.namespace)) return null;
    return this.raw.findMostRecentActive(instanceId);
  };
}
