import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  type Firestore,
} from 'firebase/firestore';
import { HumanTaskSchema, type HumanTask, type HumanTaskRepository } from '@mediforce/platform-core';

export class FirestoreHumanTaskRepository implements HumanTaskRepository {
  private readonly collectionName = 'humanTasks';

  constructor(private readonly db: Firestore) {}

  async create(task: HumanTask): Promise<HumanTask> {
    const docRef = doc(this.db, this.collectionName, task.id);
    await setDoc(docRef, task);
    return task;
  }

  async getById(taskId: string): Promise<HumanTask | null> {
    const docRef = doc(this.db, this.collectionName, taskId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return HumanTaskSchema.parse(snap.data());
  }

  async getByRole(role: string): Promise<HumanTask[]> {
    // Requires composite index: (assignedRole ASC, status ASC, createdAt ASC)
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('assignedRole', '==', role),
      where('status', 'in', ['pending', 'claimed']),
      orderBy('createdAt', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => HumanTaskSchema.parse(d.data()));
  }

  async getByInstanceId(instanceId: string): Promise<HumanTask[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(colRef, where('processInstanceId', '==', instanceId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => HumanTaskSchema.parse(d.data()));
  }

  async claim(taskId: string, userId: string): Promise<HumanTask> {
    const docRef = doc(this.db, this.collectionName, taskId);
    await updateDoc(docRef, {
      assignedUserId: userId,
      status: 'claimed',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(taskId))!;
  }

  async complete(taskId: string, completionData: Record<string, unknown>): Promise<HumanTask> {
    const now = new Date().toISOString();
    const docRef = doc(this.db, this.collectionName, taskId);
    await updateDoc(docRef, {
      status: 'completed',
      completionData,
      completedAt: now,
      updatedAt: now,
    });
    return (await this.getById(taskId))!;
  }

  async cancel(taskId: string): Promise<HumanTask> {
    const docRef = doc(this.db, this.collectionName, taskId);
    await updateDoc(docRef, {
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(taskId))!;
  }
}
