import {
  ImageCatalogEntrySchema,
  type ImageCatalogEntry,
} from '../schemas/image-catalog-entry';
import type { ImageCatalogRepository } from '../interfaces/image-catalog-repository';

/** In-memory double for ImageCatalogRepository. Stores entries keyed by
 *  `${namespace}/${entryId}` so tests can exercise namespace isolation
 *  without a database. */
export class InMemoryImageCatalogRepository implements ImageCatalogRepository {
  private readonly entries = new Map<string, ImageCatalogEntry>();

  private key(namespace: string, entryId: string): string {
    return `${namespace}/${entryId}`;
  }

  async getById(namespace: string, entryId: string): Promise<ImageCatalogEntry | null> {
    const entry = this.entries.get(this.key(namespace, entryId));
    return entry ? { ...entry } : null;
  }

  async list(namespace: string): Promise<ImageCatalogEntry[]> {
    const prefix = `${namespace}/`;
    return [...this.entries.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, entry]) => ({ ...entry }));
  }

  async upsert(namespace: string, entry: ImageCatalogEntry): Promise<ImageCatalogEntry> {
    const parsed = ImageCatalogEntrySchema.parse(entry);
    this.entries.set(this.key(namespace, parsed.id), { ...parsed });
    return { ...parsed };
  }

  async delete(namespace: string, entryId: string): Promise<void> {
    this.entries.delete(this.key(namespace, entryId));
  }

  /** Test helper: wipe all entries across namespaces. */
  clear(): void {
    this.entries.clear();
  }
}
