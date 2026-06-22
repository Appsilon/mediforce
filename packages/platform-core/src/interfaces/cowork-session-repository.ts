import type { CoworkSession, ConversationTurn } from '../schemas/cowork-session';

/**
 * Storage-layer authorization (ADR-0004): cowork sessions have no namespace
 * field — workspace is reached via the parent `ProcessInstance`.
 */
export interface CoworkSessionRepository {
  create(session: CoworkSession): Promise<CoworkSession>;

  getById(sessionId: string): Promise<CoworkSession | null>;
  getByIdInNamespaces(sessionId: string, allowed: readonly string[]): Promise<CoworkSession | null>;

  getByInstanceId(instanceId: string): Promise<CoworkSession[]>;

  /** All sessions visible to system actors (no namespace gate). */
  listAll(): Promise<CoworkSession[]>;
  /** Sessions whose parent run belongs to one of `allowed`. */
  listInNamespaces(allowed: readonly string[]): Promise<CoworkSession[]>;
  /** Sessions assigned to `role`, intersected with `allowed` namespaces. */
  listByRoleInNamespaces(role: string, allowed: readonly string[]): Promise<CoworkSession[]>;
  /** Sessions assigned to `role` across the whole store (system-actor reach). */
  listByRoleAll(role: string): Promise<CoworkSession[]>;

  /** Find the most recent active cowork session for a process instance, or null. */
  findMostRecentActive(instanceId: string): Promise<CoworkSession | null>;
  findMostRecentActiveInNamespaces(instanceId: string, allowed: readonly string[]): Promise<CoworkSession | null>;

  addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession>;
  /**
   * Update an existing turn in place by id. Used to transition a tool turn from
   * 'running' to 'success'/'error' without leaving orphaned running rows behind.
   * Throws if the turn is not found.
   */
  updateTurn(sessionId: string, turnId: string, patch: Partial<ConversationTurn>): Promise<CoworkSession>;
  updateArtifact(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession>;
  updateValidationResult(sessionId: string, result: { valid: boolean; errors: string[] }): Promise<CoworkSession>;
  updatePresentation(sessionId: string, html: string): Promise<CoworkSession>;
  finalize(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession>;
  abandon(sessionId: string): Promise<CoworkSession>;
}
