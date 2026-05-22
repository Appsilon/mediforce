import type {
  CoworkSession,
  CoworkSessionRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace-scoped cowork sessions. Namespace is reached via the parent
 * `ProcessInstance`, resolved inside the raw repo. Anti-enumeration:
 * out-of-scope paths collapse to `null` — handlers convert to 404.
 */
export class AuthorizedCoworkSessionRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: CoworkSessionRepository,
  ) {
    super(caller);
  }

  getById = async (sessionId: string): Promise<CoworkSession | null> =>
    this.caller.isSystemActor
      ? this.raw.getById(sessionId)
      : this.raw.getByIdInNamespaces(sessionId, [...this.caller.namespaces]);

  findMostRecentActiveForInstance = async (instanceId: string): Promise<CoworkSession | null> =>
    this.caller.isSystemActor
      ? this.raw.findMostRecentActive(instanceId)
      : this.raw.findMostRecentActiveInNamespaces(instanceId, [...this.caller.namespaces]);
}
