import type {
  ConversationTurn,
  CoworkSession,
  CoworkSessionRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { ForbiddenError } from '../errors';
import { AuthorizedScope } from './authorized-repository';

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

  /**
   * Caller-scope read: every session the caller is allowed to see. Optional
   * `role` filter narrows to a single assigned role. System actors see the
   * whole store; user callers see sessions whose parent run belongs to one of
   * their namespaces.
   */
  list = async (filters?: { role?: string }): Promise<CoworkSession[]> => {
    const role = filters?.role;
    if (this.caller.isSystemActor) {
      return role !== undefined ? this.raw.listByRoleAll(role) : this.raw.listAll();
    }
    const allowed = [...this.caller.namespaces];
    return role !== undefined
      ? this.raw.listByRoleInNamespaces(role, allowed)
      : this.raw.listInNamespaces(allowed);
  };

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

  updateValidationResult = async (
    sessionId: string,
    result: { valid: boolean; errors: string[] },
  ): Promise<CoworkSession> => {
    await this.requireAccess(sessionId);
    return this.raw.updateValidationResult(sessionId, result);
  };

  updatePresentation = async (
    sessionId: string,
    html: string,
  ): Promise<CoworkSession> => {
    await this.requireAccess(sessionId);
    return this.raw.updatePresentation(sessionId, html);
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
