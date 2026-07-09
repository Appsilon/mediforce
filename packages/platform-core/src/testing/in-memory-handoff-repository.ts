import { HandoffEntitySchema, type HandoffEntity } from '../schemas/handoff-entity';
import type { HandoffRepository } from '../interfaces/handoff-repository';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository';

/**
 * In-memory implementation of HandoffRepository for testing.
 * Uses a plain Map for storage. Does NOT validate payload/resolution against
 * handoffTypeRegistry — that is infrastructure's responsibility.
 *
 * Namespace-scoped methods (`*InNamespaces`) resolve the parent run's
 * namespace via the injected `ProcessInstanceRepository`. Omit when the
 * test doesn't exercise those paths.
 */
export class InMemoryHandoffRepository implements HandoffRepository {
  private readonly entities = new Map<string, HandoffEntity>();

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async create(entity: HandoffEntity): Promise<HandoffEntity> {
    // Parse on write — mirrors the Firestore + Postgres backends (ADR-0001
    // Implementation pattern 2).
    const parsed = HandoffEntitySchema.parse(entity);
    this.entities.set(parsed.id, { ...parsed });
    return { ...parsed };
  }

  async getById(entityId: string): Promise<HandoffEntity | null> {
    const entity = this.entities.get(entityId);
    return entity ? { ...entity } : null;
  }

  async getByIdInNamespaces(
    entityId: string,
    allowed: readonly string[],
  ): Promise<HandoffEntity | null> {
    const entity = this.entities.get(entityId);
    if (!entity) return null;
    const parent = await this.requireParents().getById(entity.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? { ...entity } : null;
  }

  async getByRoleAll(role: string): Promise<HandoffEntity[]> {
    return [...this.entities.values()].filter(
      (e) => e.assignedRole === role && (e.status === 'created' || e.status === 'acknowledged'),
    );
  }

  async getByRoleInNamespaces(
    role: string,
    allowed: readonly string[],
  ): Promise<HandoffEntity[]> {
    const rows = await this.getByRoleAll(role);
    return this.filterByParentNamespace(rows, allowed);
  }

  async getByInstanceId(instanceId: string): Promise<HandoffEntity[]> {
    return [...this.entities.values()].filter(
      (e) => e.processInstanceId === instanceId,
    );
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<HandoffEntity[]> {
    const parent = await this.requireParents().getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
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

  private requireParents(): ProcessInstanceRepository {
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryHandoffRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    return this.parents;
  }

  private async filterByParentNamespace<T extends { processInstanceId: string }>(
    rows: T[],
    allowed: readonly string[],
  ): Promise<T[]> {
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

  /** Test helper: clear all stored data */
  clear(): void {
    this.entities.clear();
  }

  /** Test helper: return all entities */
  getAll(): HandoffEntity[] {
    return [...this.entities.values()];
  }
}
