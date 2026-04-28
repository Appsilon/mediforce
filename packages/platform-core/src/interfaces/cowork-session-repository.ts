import type { CoworkSession, ConversationTurn } from '../schemas/cowork-session.js';

export interface CoworkSessionRepository {
  create(session: CoworkSession): Promise<CoworkSession>;
  getById(sessionId: string): Promise<CoworkSession | null>;
  getByInstanceId(instanceId: string): Promise<CoworkSession[]>;
  /** Find the most recent active cowork session for a process instance, or null. */
  findMostRecentActive(instanceId: string): Promise<CoworkSession | null>;
  addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession>;
  /**
   * Update an existing turn in place by id. Used to transition a tool turn from
   * 'running' to 'success'/'error' without leaving orphaned running rows behind.
   * Throws if the turn is not found.
   */
  updateTurn(sessionId: string, turnId: string, patch: Partial<ConversationTurn>): Promise<CoworkSession>;
  updateArtifact(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession>;
  finalize(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession>;
  abandon(sessionId: string): Promise<CoworkSession>;
}
