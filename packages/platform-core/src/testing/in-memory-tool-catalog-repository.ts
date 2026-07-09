import {
  ToolCatalogEntrySchema,
  type ToolCatalogEntry,
} from '../schemas/agent-mcp-binding';
import type { ToolCatalogRepository } from '../interfaces/tool-catalog-repository';

/** In-memory double for ToolCatalogRepository. Stores entries keyed by
 *  `${namespace}/${entryId}` so tests can exercise namespace isolation
 *  without spinning up Firestore. */
export class InMemoryToolCatalogRepository implements ToolCatalogRepository {
  private readonly entries = new Map<string, ToolCatalogEntry>();

  private key(namespace: string, entryId: string): string {
    return `${namespace}/${entryId}`;
  }

  async getById(namespace: string, entryId: string): Promise<ToolCatalogEntry | null> {
    const entry = this.entries.get(this.key(namespace, entryId));
    return entry ? { ...entry } : null;
  }

  async list(namespace: string): Promise<ToolCatalogEntry[]> {
    const prefix = `${namespace}/`;
    return [...this.entries.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, entry]) => ({ ...entry }));
  }

  async upsert(namespace: string, entry: ToolCatalogEntry): Promise<ToolCatalogEntry> {
    const parsed = ToolCatalogEntrySchema.parse(entry);
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
