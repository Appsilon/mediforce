import type { Firestore } from 'firebase-admin/firestore';
import {
  ToolCatalogEntrySchema,
  type ToolCatalogEntry,
  type ToolCatalogRepository,
} from '@mediforce/platform-core';

/** Firestore-backed ToolCatalogRepository.
 *
 *  Path: namespaces/{handle}/toolCatalog/{entryId}
 *  Doc id IS the entryId (human-readable slug, referenced by AgentMcpBinding.catalogId).
 *  Writes strip the id from the payload so it doesn't end up duplicated
 *  inside the document — the id is already the doc path. */
export class FirestoreToolCatalogRepository implements ToolCatalogRepository {
  constructor(private readonly db: Firestore) {}

  private col(namespace: string) {
    return this.db.collection('namespaces').doc(namespace).collection('toolCatalog');
  }

  async getById(namespace: string, entryId: string): Promise<ToolCatalogEntry | null> {
    const snap = await this.col(namespace).doc(entryId).get();
    if (!snap.exists) return null;
    return ToolCatalogEntrySchema.parse({ ...snap.data(), id: snap.id });
  }

  async list(namespace: string): Promise<ToolCatalogEntry[]> {
    const snap = await this.col(namespace).get();
    return snap.docs.map((d) => ToolCatalogEntrySchema.parse({ ...d.data(), id: d.id }));
  }

  async upsert(namespace: string, entry: ToolCatalogEntry): Promise<ToolCatalogEntry> {
    const parsed = ToolCatalogEntrySchema.parse(entry);
    const { id, ...body } = parsed;
    await this.col(namespace).doc(id).set(body);
    return parsed;
  }

  async delete(namespace: string, entryId: string): Promise<void> {
    await this.col(namespace).doc(entryId).delete();
  }
}
