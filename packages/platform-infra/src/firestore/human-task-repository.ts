import type { Firestore } from 'firebase-admin/firestore';
import { HumanTaskSchema, type HumanTask, type HumanTaskRepository } from '@mediforce/platform-core';

export class FirestoreHumanTaskRepository implements HumanTaskRepository {
  private readonly collectionName = 'humanTasks';

  constructor(private readonly db: Firestore) {}

  async create(task: HumanTask): Promise<HumanTask> {
    await this.db.collection(this.collectionName).doc(task.id).set(task);
    return task;
  }

  async getById(taskId: string): Promise<HumanTask | null> {
    const snap = await this.db.collection(this.collectionName).doc(taskId).get();
    if (!snap.exists) return null;
    return HumanTaskSchema.parse(snap.data());
  }

  async getByRole(role: string): Promise<HumanTask[]> {
    // Requires composite index: (assignedRole ASC, createdAt ASC).
    // No status filter — callers narrow explicitly if they need actionable-only.
    const snap = await this.db
      .collection(this.collectionName)
      .where('assignedRole', '==', role)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => HumanTaskSchema.parse(d.data()));
  }

  async getByInstanceId(instanceId: string): Promise<HumanTask[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .get();
    return snap.docs.map((d) => HumanTaskSchema.parse(d.data()));
  }

  async claim(taskId: string, userId: string): Promise<HumanTask> {
    await this.db.collection(this.collectionName).doc(taskId).update({
      assignedUserId: userId,
      status: 'claimed',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(taskId))!;
  }

  async complete(taskId: string, completionData: Record<string, unknown>): Promise<HumanTask> {
    const now = new Date().toISOString();
    await this.db.collection(this.collectionName).doc(taskId).update({
      status: 'completed',
      completionData,
      completedAt: now,
      updatedAt: now,
    });
    return (await this.getById(taskId))!;
  }

  async cancel(taskId: string): Promise<HumanTask> {
    await this.db.collection(this.collectionName).doc(taskId).update({
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(taskId))!;
  }

  async setDeletedByInstanceIds(instanceIds: string[], deleted: boolean): Promise<void> {
    if (instanceIds.length === 0) return;
    // Firestore 'in' queries support max 30 values per batch
    for (let i = 0; i < instanceIds.length; i += 30) {
      const batch = instanceIds.slice(i, i + 30);
      const snap = await this.db
        .collection(this.collectionName)
        .where('processInstanceId', 'in', batch)
        .get();
      for (const d of snap.docs) {
        await this.db.collection(this.collectionName).doc(d.id).update({ deleted });
      }
    }
  }
}
