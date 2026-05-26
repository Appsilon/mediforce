import type {
  ConversationTurn,
  CoworkSession,
  CoworkSessionRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace-scoped cowork sessions. Namespace is reached via the parent
 * `ProcessInstance`, resolved inside the raw repo. Anti-enumeration:
 * out-of-scope paths collapse to `null` — handlers convert to 404.
 *
 * Mutations gate via `getById` first: a user caller outside the parent
 * instance's namespace gets `ForbiddenError`, matching the
 * `AuthorizedWorkflowRunRepository.update` pattern.
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

  addTurn = async (sessionId: string, turn: ConversationTurn): Promise<CoworkSession> => {
    await this.requireAccess(sessionId);
    return this.raw.addTurn(sessionId, turn);
  };

  updateTurn = async (
    sessionId: string,
    turnId: string,
    patch: Partial<ConversationTurn>,
  ): Promise<CoworkSession> => {
    await this.requireAccess(sessionId);
    return this.raw.updateTurn(sessionId, turnId, patch);
  };

  updateArtifact = async (
    sessionId: string,
    artifact: Record<string, unknown>,
  ): Promise<CoworkSession> => {
    await this.requireAccess(sessionId);
    return this.raw.updateArtifact(sessionId, artifact);
  };

  finalize = async (
    sessionId: string,
    artifact: Record<string, unknown>,
  ): Promise<CoworkSession> => {
    await this.requireAccess(sessionId);
    return this.raw.finalize(sessionId, artifact);
  };

  private async requireAccess(sessionId: string): Promise<void> {
    const existing = await this.getById(sessionId);
    if (existing === null) {
      throw new ForbiddenError();
    }
  }
}
