import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  ModelRegistryEntrySchema,
  type ModelRegistryEntry,
  type ModelRegistryMeta,
  type ModelRegistryRepository,
  type CreateModelRegistryEntryInput,
  type UpdateModelRegistryEntryInput,
} from '@mediforce/platform-core';

// OpenRouter IDs use provider/model format. Firestore doc IDs can't contain
// slashes, so we encode as provider__model. This is lossy if an ID ever
// contains literal "__", but no OpenRouter model uses that pattern.
function encodeModelId(id: string): string {
  return id.replaceAll('/', '__');
}

function decodeModelId(docId: string): string {
  return docId.replaceAll('__', '/');
}

function toModel(docId: string, data: Record<string, unknown>): ModelRegistryEntry {
  return ModelRegistryEntrySchema.parse({
    ...data,
    id: decodeModelId(docId),
    requestCount: data.requestCount ?? null,
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

const META_DOC_ID = '_meta';

export class FirestoreModelRegistryRepository implements ModelRegistryRepository {
  constructor(private readonly db: Firestore) {}

  private get col() {
    return this.db.collection('modelRegistry');
  }

  async getById(id: string): Promise<ModelRegistryEntry | null> {
    const snap = await this.col.doc(encodeModelId(id)).get();
    if (!snap.exists) return null;
    return toModel(snap.id, snap.data() as Record<string, unknown>);
  }

  async list(): Promise<ModelRegistryEntry[]> {
    const snap = await this.col.get();
    return snap.docs
      .filter((d) => d.id !== META_DOC_ID)
      .map((d) => toModel(d.id, d.data()));
  }

  async upsert(entry: CreateModelRegistryEntryInput): Promise<ModelRegistryEntry> {
    const docId = encodeModelId(entry.id);
    const ref = this.col.doc(docId);
    const now = FieldValue.serverTimestamp();
    const existing = await ref.get();
    const createdAt = existing.exists ? (existing.data()?.createdAt ?? now) : now;
    await ref.set({ ...entry, createdAt, updatedAt: now });
    const snap = await ref.get();
    return toModel(snap.id, snap.data() as Record<string, unknown>);
  }

  async update(input: UpdateModelRegistryEntryInput): Promise<ModelRegistryEntry> {
    const { id, ...fields } = input;
    const ref = this.col.doc(encodeModelId(id));
    await ref.update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
    const snap = await ref.get();
    return toModel(snap.id, snap.data() as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    await this.col.doc(encodeModelId(id)).delete();
  }

  async bulkUpsert(entries: CreateModelRegistryEntryInput[]): Promise<number> {
    const batchSize = 500;
    const existingSnap = await this.col.select().get();
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));
    let synced = 0;
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const chunk = entries.slice(offset, offset + batchSize);
      const batch = this.db.batch();
      const now = FieldValue.serverTimestamp();
      for (const entry of chunk) {
        const docId = encodeModelId(entry.id);
        const ref = this.col.doc(docId);
        const isNew = !existingIds.has(docId);
        batch.set(ref, { ...entry, updatedAt: now, ...(isNew ? { createdAt: now } : {}) }, { merge: true });
      }
      await batch.commit();
      synced += chunk.length;
    }
    return synced;
  }

  async updateRankings(rankings: Array<{ id: string; requestCount: number }>): Promise<number> {
    const batchSize = 500;
    let updated = 0;
    for (let offset = 0; offset < rankings.length; offset += batchSize) {
      const chunk = rankings.slice(offset, offset + batchSize);
      const batch = this.db.batch();
      for (const { id, requestCount } of chunk) {
        const ref = this.col.doc(encodeModelId(id));
        batch.update(ref, { requestCount });
      }
      await batch.commit();
      updated += chunk.length;
    }
    await this.col.doc(META_DOC_ID).set(
      { rankingsUpdatedAt: new Date().toISOString() },
      { merge: true },
    );
    return updated;
  }

  async getMeta(): Promise<ModelRegistryMeta> {
    const snap = await this.col.doc(META_DOC_ID).get();
    if (!snap.exists) return { rankingsUpdatedAt: null };
    const data = snap.data() as Record<string, unknown>;
    return { rankingsUpdatedAt: (data.rankingsUpdatedAt as string) ?? null };
  }
}
