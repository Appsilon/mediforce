import type { Firestore } from 'firebase-admin/firestore';
import {
  HandoffEntitySchema,
  type HandoffEntity,
  type HandoffRepository,
  handoffTypeRegistry,
} from '@mediforce/platform-core';

export class FirestoreHandoffRepository implements HandoffRepository {
  private readonly collectionName = 'handoffEntities';

  constructor(private readonly db: Firestore) {}

  async create(entity: HandoffEntity): Promise<HandoffEntity> {
    await this.db.collection(this.collectionName).doc(entity.id).set(entity);
    return entity;
  }

  async getById(entityId: string): Promise<HandoffEntity | null> {
    const snap = await this.db.collection(this.collectionName).doc(entityId).get();
    if (!snap.exists) return null;
    return HandoffEntitySchema.parse(snap.data());
  }

  async getByRole(role: string): Promise<HandoffEntity[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('assignedRole', '==', role)
      .where('status', 'in', ['created', 'acknowledged'])
      .get();
    return snap.docs.map((d) => HandoffEntitySchema.parse(d.data()));
  }

  async getByInstanceId(instanceId: string): Promise<HandoffEntity[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .get();
    return snap.docs.map((d) => HandoffEntitySchema.parse(d.data()));
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
}
