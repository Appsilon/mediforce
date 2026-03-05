import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
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
    const docRef = doc(this.db, this.collectionName, entity.id);
    await setDoc(docRef, entity);
    return entity;
  }

  async getById(entityId: string): Promise<HandoffEntity | null> {
    const docRef = doc(this.db, this.collectionName, entityId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return HandoffEntitySchema.parse(snap.data());
  }

  async getByRole(role: string): Promise<HandoffEntity[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('assignedRole', '==', role),
      where('status', 'in', ['created', 'acknowledged']),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => HandoffEntitySchema.parse(d.data()));
  }

  async getByInstanceId(instanceId: string): Promise<HandoffEntity[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(colRef, where('processInstanceId', '==', instanceId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => HandoffEntitySchema.parse(d.data()));
  }

  async claim(entityId: string, userId: string): Promise<HandoffEntity> {
    const docRef = doc(this.db, this.collectionName, entityId);
    await updateDoc(docRef, {
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
    const docRef = doc(this.db, this.collectionName, entityId);
    await updateDoc(docRef, { status: 'acknowledged', updatedAt: new Date().toISOString() });
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
    // Validate resolution against app-registered schema
    const resolutionSchema = handoffTypeRegistry.getResolutionSchema(entity.type);
    resolutionSchema.parse(resolution);

    const now = new Date().toISOString();
    const docRef = doc(this.db, this.collectionName, entityId);
    await updateDoc(docRef, { status: 'resolved', resolution, resolvedAt: now, updatedAt: now });
    return (await this.getById(entityId))!;
  }
}
