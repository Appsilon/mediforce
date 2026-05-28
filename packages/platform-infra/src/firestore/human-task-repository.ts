import type { Firestore } from 'firebase-admin/firestore';
import {
  HumanTaskSchema,
  type HumanTask,
  type HumanTaskRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';

export class FirestoreHumanTaskRepository implements HumanTaskRepository {
  private readonly collectionName = 'humanTasks';

  constructor(
    private readonly db: Firestore,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(task: HumanTask): Promise<HumanTask> {
    await this.db.collection(this.collectionName).doc(task.id).set(task);
    return task;
  }

  async getById(taskId: string): Promise<HumanTask | null> {
    const snap = await this.db.collection(this.collectionName).doc(taskId).get();
    if (!snap.exists) return null;
    return HumanTaskSchema.parse(snap.data());
  }

  async getByIdInNamespaces(
    taskId: string,
    allowed: readonly string[],
  ): Promise<HumanTask | null> {
    const task = await this.getById(taskId);
    if (task === null) return null;
    const parent = await this.parents.getById(task.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? task : null;
  }

  async getByRoleAll(role: string): Promise<HumanTask[]> {
    // Requires composite index: (assignedRole ASC, createdAt ASC).
    // No status filter — callers narrow explicitly if they need actionable-only.
    const snap = await this.db
      .collection(this.collectionName)
      .where('assignedRole', '==', role)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => HumanTaskSchema.parse(d.data()));
  }

  async getByRoleInNamespaces(
    role: string,
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    const rows = await this.getByRoleAll(role);
    return this.filterByParentNamespace(rows, allowed);
  }

  async getByInstanceId(instanceId: string): Promise<HumanTask[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .get();
    return snap.docs.map((d) => HumanTaskSchema.parse(d.data()));
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    const parent = await this.parents.getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
  }

  async getByInstanceIdsAll(
    instanceIds: readonly string[],
  ): Promise<HumanTask[]> {
    if (instanceIds.length === 0) return [];
    // Firestore `in` accepts at most 30 values per query; chunk and fan
    // out in parallel so a 113-instance monitoring summary collapses to
    // ~4 indexed reads instead of 113 single-doc lookups.
    const chunkSize = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < instanceIds.length; i += chunkSize) {
      chunks.push([...instanceIds.slice(i, i + chunkSize)]);
    }
    const snapshots = await Promise.all(
      chunks.map((chunk) =>
        this.db
          .collection(this.collectionName)
          .where('processInstanceId', 'in', chunk)
          .get(),
      ),
    );
    return snapshots.flatMap((snap) =>
      snap.docs.map((d) => HumanTaskSchema.parse(d.data())),
    );
  }

  async getByInstanceIdsInNamespaces(
    instanceIds: readonly string[],
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    const parents = await Promise.all(instanceIds.map((id) => this.parents.getById(id)));
    const allowedIds = instanceIds.filter((_, i) => {
      const parent = parents[i];
      return parent !== null && typeof parent.namespace === 'string' && allowed.includes(parent.namespace);
    });
    return this.getByInstanceIdsAll(allowedIds);
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
