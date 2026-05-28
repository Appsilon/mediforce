import { FieldPath, type Firestore } from 'firebase-admin/firestore';
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
    const parentNs = await this.parents.getNamespaceById(task.processInstanceId);
    if (parentNs === null) return null;
    return allowed.includes(parentNs) ? task : null;
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
    const parentNs = await this.parents.getNamespaceById(instanceId);
    if (parentNs === null || !allowed.includes(parentNs)) return [];
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
    // Skip per-row `HumanTaskSchema.parse` for the same reason
    // `FirestoreProcessInstanceRepository.listAll` skips its parse: a
    // single legacy doc with an out-of-enum `status` or a `Timestamp`-
    // typed `updatedAt` would otherwise 400 the whole monitoring summary
    // (which fans out across every workspace task). The monitoring
    // aggregator tolerates the raw shape — unknown statuses skip the
    // bucket. Callers that need the strict shape (e.g. the per-instance
    // `getByInstanceId`) still parse.
    return snapshots.flatMap((snap) =>
      snap.docs.map((d) => d.data() as HumanTask),
    );
  }

  async getByInstanceIdsInNamespaces(
    instanceIds: readonly string[],
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    if (instanceIds.length === 0) return [];
    // Bulk-resolve parent namespaces in chunks of 30 — Firestore's `in`
    // operator limit. 322 parents collapse from 322 single-doc gets
    // (~37 s saturated user-actor monitoring on appsilon) to ~11
    // parallel indexed queries (~2 s).
    const chunkSize = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < instanceIds.length; i += chunkSize) {
      chunks.push([...instanceIds.slice(i, i + chunkSize)]);
    }
    const allowedSet = new Set(allowed);
    const snapshots = await Promise.all(
      chunks.map((chunk) =>
        this.db
          .collection('processInstances')
          .where(FieldPath.documentId(), 'in', chunk)
          .get(),
      ),
    );
    const namespaceById = new Map<string, string>();
    for (const snap of snapshots) {
      for (const doc of snap.docs) {
        const ns = (doc.data() as { namespace?: unknown }).namespace;
        if (typeof ns === 'string' && ns.length > 0) {
          namespaceById.set(doc.id, ns);
        }
      }
    }
    const allowedIds = instanceIds.filter((id) => {
      const ns = namespaceById.get(id);
      return ns !== undefined && allowedSet.has(ns);
    });
    return this.getByInstanceIdsAll(allowedIds);
  }

  async listAll(): Promise<HumanTask[]> {
    // Caller-scope read path. Newest first matches the human-queue convention
    // already established by `getByRoleAll`; the `createdAt` order is the
    // single sort the UI relies on.
    const snap = await this.db
      .collection(this.collectionName)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) => HumanTaskSchema.parse(d.data()));
  }

  async listInNamespaces(allowed: readonly string[]): Promise<HumanTask[]> {
    // HumanTask has no namespace field; the parent ProcessInstance owns
    // workspace membership. Pre-materialise the allowed `processInstanceId`
    // set via one indexed `where('namespace','==', ns)` read per workspace
    // (Promise.all in parallel for multi-workspace callers), then a single
    // human-tasks collection scan + in-memory join. Two-pass shape kills
    // the N+1 `parents.getById()` that made the agent-runs equivalent
    // ~40 s on a 2.3k-run workspace before the same fix (PR2 #569 + the
    // perf commit at `7cccb6f1`); applies the same here for caller-scope
    // human tasks. Postgres collapses both passes into one JOIN —
    // ADR-0001 + #588.
    const allowedInstanceIds = new Set<string>();
    await Promise.all(
      allowed.map(async (ns) => {
        const snap = await this.db
          .collection('processInstances')
          .where('namespace', '==', ns)
          .get();
        for (const doc of snap.docs) allowedInstanceIds.add(doc.id);
      }),
    );
    if (allowedInstanceIds.size === 0) return [];
    const rows = await this.listAll();
    return rows.filter((t) => allowedInstanceIds.has(t.processInstanceId));
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
