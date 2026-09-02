import type { ImageCatalogEntry } from '../schemas/image-catalog-entry';

/** Per-namespace catalog of the images the platform offers for steps
 *  (ADR-0021). Keyed by an id derived from the entry's source, so two builds
 *  of the same source reconcile onto one row.
 *
 *  Every operation is namespace-scoped. Unlike the Tool Catalog this store
 *  governs nothing at run time — an entry names an image string any author
 *  can already type — which is why its write gate is workspace membership
 *  rather than admin (ADR-0021 decision 3). */
export interface ImageCatalogRepository {
  /** Return the entry with the given id, or null when absent. */
  getById(namespace: string, entryId: string): Promise<ImageCatalogEntry | null>;
  /** Return all entries in the namespace, in no guaranteed order. */
  list(namespace: string): Promise<ImageCatalogEntry[]>;
  /** Create or replace an entry. */
  upsert(namespace: string, entry: ImageCatalogEntry): Promise<ImageCatalogEntry>;
  /** Remove an entry. No-op when id is absent. */
  delete(namespace: string, entryId: string): Promise<void>;
}
