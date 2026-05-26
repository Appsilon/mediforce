import type { Firestore } from 'firebase-admin/firestore';
import {
  HandoffEntitySchema,
  type HandoffEntity,
  type HandoffRepository,
  type ProcessInstanceRepository,
  handoffTypeRegistry,
} from '@mediforce/platform-core';

export class FirestoreHandoffRepository implements HandoffRepository {
  private readonly collectionName = 'handoffEntities';

  constructor(
    private readonly db: Firestore,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(entity: HandoffEntity): Promise<HandoffEntity> {
    await this.db.collection(this.collectionName).doc(entity.id).set(entity);
    return entity;
  }

  async getById(entityId: string): Promise<HandoffEntity | null> {
    const snap = await this.db.collection(this.collectionName).doc(entityId).get();
    if (!snap.exists) return null;
    return HandoffEntitySchema.parse(snap.data());
  }

  async getByIdInNamespaces(
    entityId: string,
    allowed: readonly string[],
  ): Promise<HandoffEntity | null> {
    const entity = await this.getById(entityId);
    if (entity === null) return null;
    const parent = await this.parents.getById(entity.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? entity : null;
  }

  async getByRoleAll(role: string): Promise<HandoffEntity[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('assignedRole', '==', role)
      .where('status', 'in', ['created', 'acknowledged'])
      .get();
    return snap.docs.map((d) => HandoffEntitySchema.parse(d.data()));
  }

  async getByRoleInNamespaces(
    role: string,
    allowed: readonly string[],
  ): Promise<HandoffEntity[]> {
    const rows = await this.getByRoleAll(role);
    return this.filterByParentNamespace(rows, allowed);
  }

  async getByInstanceId(instanceId: string): Promise<HandoffEntity[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .get();
    return snap.docs.map((d) => HandoffEntitySchema.parse(d.data()));
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<HandoffEntity[]> {
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
  }

  async claim(entityId: string, userId: string): Promise<HandoffEntity> {
    await this.db.collection(this.collectionName).doc(entityId).update({
      assignedUserId: userId,
      status: 'acknowledged',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(entityId))!;
  }

  async acknowledge(entityId: string, userId: string): Promise<HandoffEntity> {
    const entity = await this.getById(entityId);
    if (!entity) throw new Error(`HandoffEntity '${entityId}' not found`);
    if (entity.assignedUserId !== userId) {
      throw new Error(
        `User '${userId}' cannot acknowledge handoff '${entityId}': assigned to '${entity.assignedUserId}'`,
      );
    }
    await this.db
      .collection(this.collectionName)
      .doc(entityId)
      .update({ status: 'acknowledged', updatedAt: new Date().toISOString() });
    return (await this.getById(entityId))!;
  }

  async resolve(
    entityId: string,
    userId: string,
    resolution: Record<string, unknown>,
  ): Promise<HandoffEntity> {
    const entity = await this.getById(entityId);
    if (!entity) throw new Error(`HandoffEntity '${entityId}' not found`);
    if (entity.assignedUserId !== userId) {
      throw new Error(
        `User '${userId}' cannot resolve handoff '${entityId}': assigned to '${entity.assignedUserId}'`,
      );
    }
    const resolutionSchema = handoffTypeRegistry.getResolutionSchema(entity.type);
    resolutionSchema.parse(resolution);

    const now = new Date().toISOString();
    await this.db
      .collection(this.collectionName)
      .doc(entityId)
      .update({ status: 'resolved', resolution, resolvedAt: now, updatedAt: now });
    return (await this.getById(entityId))!;
  }

  private async filterByParentNamespace<T extends { processInstanceId: string }>(
    rows: T[],
    allowed: readonly string[],
  ): Promise<T[]> {
    if (rows.length === 0) return [];
    const instanceIds = [...new Set(rows.map((r) => r.processInstanceId))];
    const namespaceById = new Map<string, string | undefined>();
    await Promise.all(
      instanceIds.map(async (id) => {
        const parent = await this.parents.getById(id);
        namespaceById.set(id, parent?.namespace);
      }),
    );
    return rows.filter((r) => {
      const ns = namespaceById.get(r.processInstanceId);
      return typeof ns === 'string' && allowed.includes(ns);
    });
  }
}
