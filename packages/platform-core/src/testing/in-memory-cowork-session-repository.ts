import type { CoworkSession, ConversationTurn } from '../schemas/cowork-session.js';
import type { CoworkSessionRepository } from '../interfaces/cowork-session-repository.js';

/**
 * In-memory implementation of CoworkSessionRepository for testing.
 * Uses a plain Map for storage. Does not call external services.
 */
export class InMemoryCoworkSessionRepository implements CoworkSessionRepository {
  private readonly sessions = new Map<string, CoworkSession>();

  async create(session: CoworkSession): Promise<CoworkSession> {
    this.sessions.set(session.id, { ...session, turns: [...session.turns] });
    return { ...session, turns: [...session.turns] };
  }

  async getById(sessionId: string): Promise<CoworkSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session, turns: [...session.turns] } : null;
  }

  async getByInstanceId(instanceId: string): Promise<CoworkSession[]> {
    return [...this.sessions.values()].filter(
      (s) => s.processInstanceId === instanceId,
    );
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const now = new Date().toISOString();
    const updated: CoworkSession = {
      ...session,
      turns: [...session.turns, turn],
      updatedAt: now,
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, turns: [...updated.turns] };
  }

  async updateArtifact(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const now = new Date().toISOString();
    const updated: CoworkSession = {
      ...session,
      artifact,
      updatedAt: now,
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, turns: [...updated.turns] };
  }

  async finalize(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const now = new Date().toISOString();
    const updated: CoworkSession = {
      ...session,
      status: 'finalized',
      artifact,
      updatedAt: now,
      finalizedAt: now,
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, turns: [...updated.turns] };
  }

  async abandon(sessionId: string): Promise<CoworkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const now = new Date().toISOString();
    const updated: CoworkSession = {
      ...session,
      status: 'abandoned',
      updatedAt: now,
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, turns: [...updated.turns] };
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.sessions.clear();
  }

  /** Test helper: return all sessions */
  getAll(): CoworkSession[] {
    return [...this.sessions.values()];
  }
}
