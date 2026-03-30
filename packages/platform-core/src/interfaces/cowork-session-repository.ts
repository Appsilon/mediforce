import type { CoworkSession, ConversationTurn } from '../schemas/cowork-session.js';

export interface CoworkSessionRepository {
  create(session: CoworkSession): Promise<CoworkSession>;
  getById(sessionId: string): Promise<CoworkSession | null>;
  getByInstanceId(instanceId: string): Promise<CoworkSession[]>;
  addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession>;
  updateArtifact(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession>;
  finalize(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession>;
  abandon(sessionId: string): Promise<CoworkSession>;
}
