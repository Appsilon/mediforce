import {
  CoworkSessionSchema,
  ConversationTurnSchema,
  type CoworkSession,
  type ConversationTurn,
} from '../schemas/cowork-session';
import type { CoworkSessionRepository } from '../interfaces/cowork-session-repository';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository';

/**
 * In-memory implementation of CoworkSessionRepository for testing.
 * Uses a plain Map for storage. Does not call external services.
 *
 * Namespace-scoped reads resolve the parent run's namespace via the
 * injected `ProcessInstanceRepository`. Tests that don't exercise those
 * paths may omit the dep.
 */
export class InMemoryCoworkSessionRepository implements CoworkSessionRepository {
  private readonly sessions = new Map<string, CoworkSession>();

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async create(session: CoworkSession): Promise<CoworkSession> {
    const parsed = CoworkSessionSchema.parse(session);
    this.sessions.set(parsed.id, { ...parsed, turns: [...parsed.turns] });
    return { ...parsed, turns: [...parsed.turns] };
  }

  async getById(sessionId: string): Promise<CoworkSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session, turns: [...session.turns] } : null;
  }

  async getByIdInNamespaces(sessionId: string, allowed: readonly string[]): Promise<CoworkSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const parent = await this.requireParents().getById(session.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    if (!allowed.includes(parent.namespace)) return null;
    return { ...session, turns: [...session.turns] };
  }

  async getByInstanceId(instanceId: string): Promise<CoworkSession[]> {
    return [...this.sessions.values()].filter((s) => s.processInstanceId === instanceId);
  }

  async listAll(): Promise<CoworkSession[]> {
    return [...this.sessions.values()]
      .map((s) => ({ ...s, turns: [...s.turns] }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listInNamespaces(allowed: readonly string[]): Promise<CoworkSession[]> {
    return this.filterByParentNamespace(await this.listAll(), allowed);
  }

  async listByRoleAll(role: string): Promise<CoworkSession[]> {
    return [...this.sessions.values()]
      .filter((s) => s.assignedRole === role)
      .map((s) => ({ ...s, turns: [...s.turns] }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByRoleInNamespaces(role: string, allowed: readonly string[]): Promise<CoworkSession[]> {
    return this.filterByParentNamespace(await this.listByRoleAll(role), allowed);
  }

  async findMostRecentActive(instanceId: string): Promise<CoworkSession | null> {
    const active = [...this.sessions.values()]
      .filter((s) => s.processInstanceId === instanceId && s.status === 'active')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return active[0] ?? null;
  }

  async findMostRecentActiveInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<CoworkSession | null> {
    const parent = await this.requireParents().getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    if (!allowed.includes(parent.namespace)) return null;
    return this.findMostRecentActive(instanceId);
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession> {
    const parsedTurn = ConversationTurnSchema.parse(turn);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const now = new Date().toISOString();
    const updated: CoworkSession = {
      ...session,
      turns: [...session.turns, parsedTurn],
      updatedAt: now,
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, turns: [...updated.turns] };
  }

  async updateTurn(sessionId: string, turnId: string, patch: Partial<ConversationTurn>): Promise<CoworkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const index = session.turns.findIndex((t) => t.id === turnId);
    if (index === -1) throw new Error(`Turn not found: ${turnId}`);
    const now = new Date().toISOString();
    // role is the discriminant — patch cannot change it, and id stays fixed.
    const merged = {
      ...session.turns[index],
      ...patch,
      id: session.turns[index].id,
      role: session.turns[index].role,
    } as ConversationTurn;
    const newTurns: ConversationTurn[] = session.turns.map((t, i) => (i === index ? merged : t));
    const updated: CoworkSession = {
      ...session,
      turns: newTurns,
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

  async updateValidationResult(
    sessionId: string,
    result: { valid: boolean; errors: string[] },
  ): Promise<CoworkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const now = new Date().toISOString();
    const updated: CoworkSession = {
      ...session,
      validationResult: result,
      updatedAt: now,
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, turns: [...updated.turns] };
  }

  async updatePresentation(sessionId: string, html: string): Promise<CoworkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const now = new Date().toISOString();
    const updated: CoworkSession = {
      ...session,
      presentation: html,
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

  private async filterByParentNamespace(rows: CoworkSession[], allowed: readonly string[]): Promise<CoworkSession[]> {
    if (rows.length === 0) return [];
    const parents = this.requireParents();
    const instanceIds = [...new Set(rows.map((r) => r.processInstanceId))];
    const namespaceById = new Map<string, string | undefined>();
    await Promise.all(
      instanceIds.map(async (id) => {
        const parent = await parents.getById(id);
        namespaceById.set(id, parent?.namespace);
      }),
    );
    return rows.filter((r) => {
      const ns = namespaceById.get(r.processInstanceId);
      return typeof ns === 'string' && allowed.includes(ns);
    });
  }

  private requireParents(): ProcessInstanceRepository {
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryCoworkSessionRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    return this.parents;
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
