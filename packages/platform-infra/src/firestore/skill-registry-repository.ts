import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  SkillRegistrySchema,
  type SkillRegistry,
  type SkillRegistryRepository,
  type CreateSkillRegistryInput,
  type UpdateSkillRegistryInput,
} from '@mediforce/platform-core';

function toSkillRegistry(id: string, data: Record<string, unknown>): SkillRegistry {
  return SkillRegistrySchema.parse({
    ...data,
    id,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : String(data.createdAt),
    updatedAt:
      data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : String(data.updatedAt),
  });
}

export class FirestoreSkillRegistryRepository implements SkillRegistryRepository {
  constructor(private readonly db: Firestore) {}

  private get col() {
    return this.db.collection('skillRegistries');
  }

  async create(input: CreateSkillRegistryInput): Promise<SkillRegistry> {
    const now = FieldValue.serverTimestamp();
    const ref = await this.col.add({ ...input, createdAt: now, updatedAt: now });
    const snap = await ref.get();
    return toSkillRegistry(ref.id, snap.data() as Record<string, unknown>);
  }

  async upsert(id: string, input: CreateSkillRegistryInput): Promise<SkillRegistry> {
    const ref = this.col.doc(id);
    const now = FieldValue.serverTimestamp();
    const existing = await ref.get();
    const createdAt = existing.exists ? (existing.data()?.createdAt ?? now) : now;
    await ref.set({ ...input, createdAt, updatedAt: now });
    const snap = await ref.get();
    return toSkillRegistry(snap.id, snap.data() as Record<string, unknown>);
  }

  async getById(id: string): Promise<SkillRegistry | null> {
    const snap = await this.col.doc(id).get();
    if (!snap.exists) return null;
    return toSkillRegistry(snap.id, snap.data() as Record<string, unknown>);
  }

  async list(): Promise<SkillRegistry[]> {
    const snap = await this.col.get();
    return snap.docs.map((d) => toSkillRegistry(d.id, d.data()));
  }

  async update(id: string, input: UpdateSkillRegistryInput): Promise<SkillRegistry> {
    const ref = this.col.doc(id);
    await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() });
    const snap = await ref.get();
    return toSkillRegistry(snap.id, snap.data() as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    await this.col.doc(id).delete();
  }
}
