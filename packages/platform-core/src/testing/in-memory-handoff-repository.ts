import type { HandoffEntity } from '../schemas/handoff-entity.js';
import type { HandoffRepository } from '../interfaces/handoff-repository.js';

/**
 * In-memory implementation of HandoffRepository for testing.
 * Uses a plain Map for storage. Does NOT validate payload/resolution against
 * handoffTypeRegistry — that is infrastructure's responsibility.
 * Reusable by any package that needs test doubles for handoff operations.
 */
export class InMemoryHandoffRepository implements HandoffRepository {
  private readonly entities = new Map<string, HandoffEntity>();

  async create(entity: HandoffEntity): Promise<HandoffEntity> {
    this.entities.set(entity.id, { ...entity });
    return { ...entity };
  }

  async getById(entityId: string): Promise<HandoffEntity | null> {
    const entity = this.entities.get(entityId);
    return entity ? { ...entity } : null;
  }

  async getByRole(role: string): Promise<HandoffEntity[]> {
    return [...this.entities.values()].filter(
      (e) => e.assignedRole === role && (e.status === 'created' || e.status === 'acknowledged'),
    );
  }

  async getByInstanceId(instanceId: string): Promise<HandoffEntity[]> {
    return [...this.entities.values()].filter(
      (e) => e.processInstanceId === instanceId,
    );
  }

  async claim(entityId: string, userId: string): Promise<HandoffEntity> {
    const entity = this.entities.get(entityId);
    if (!entity) throw new Error(`HandoffEntity not found: ${entityId}`);
    const now = new Date().toISOString();
    const updated: HandoffEntity = {
      ...entity,
      assignedUserId: userId,
      status: 'acknowledged',
      updatedAt: now,
    };
    this.entities.set(entityId, updated);
    return { ...updated };
  }

  async acknowledge(entityId: string, userId: string): Promise<HandoffEntity> {
    const entity = this.entities.get(entityId);
    if (!entity) throw new Error(`HandoffEntity not found: ${entityId}`);
    if (entity.assignedUserId !== userId) {
      throw new Error(
        `User '${userId}' cannot acknowledge handoff '${entityId}' — assigned to '${entity.assignedUserId}'`,
      );
    }
    const now = new Date().toISOString();
    const updated: HandoffEntity = {
      ...entity,
      status: 'acknowledged',
      updatedAt: now,
    };
    this.entities.set(entityId, updated);
    return { ...updated };
  }

  async resolve(
    entityId: string,
    userId: string,
    resolution: Record<string, unknown>,
  ): Promise<HandoffEntity> {
    const entity = this.entities.get(entityId);
    if (!entity) throw new Error(`HandoffEntity not found: ${entityId}`);
    if (entity.assignedUserId !== userId) {
      throw new Error(
        `User '${userId}' cannot resolve handoff '${entityId}' — assigned to '${entity.assignedUserId}'`,
      );
    }
    const now = new Date().toISOString();
    const updated: HandoffEntity = {
      ...entity,
      status: 'resolved',
      resolution,
      resolvedAt: now,
      updatedAt: now,
    };
    this.entities.set(entityId, updated);
    return { ...updated };
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.entities.clear();
  }

  /** Test helper: return all entities */
  getAll(): HandoffEntity[] {
    return [...this.entities.values()];
  }
}
