import type {
  ToolCatalogEntry,
  ToolCatalogRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedRepository } from './authorized-repository.js';

/**
 * Workspace-scoped view of `ToolCatalogRepository`. The underlying store is
 * organised as `namespaces/{handle}/toolCatalog/*`, so the namespace is a
 * required argument on every method; the wrapper asserts membership before
 * delegating.
 */
export interface AuthorizedToolCatalogRepository {
  getById(namespace: string, entryId: string): Promise<ToolCatalogEntry | null>;
  list(namespace: string): Promise<ToolCatalogEntry[]>;
  upsert(namespace: string, entry: ToolCatalogEntry): Promise<ToolCatalogEntry>;
  delete(namespace: string, entryId: string): Promise<void>;
}

export class AuthorizedToolCatalogRepositoryImpl
  extends AuthorizedRepository<ToolCatalogEntry>
  implements AuthorizedToolCatalogRepository
{
  constructor(
    caller: CallerIdentity,
    private readonly raw: ToolCatalogRepository,
  ) {
    super(caller);
  }

  getById = async (namespace: string, entryId: string): Promise<ToolCatalogEntry | null> => {
    if (!this.canSeeNamespace(namespace)) return null;
    return this.raw.getById(namespace, entryId);
  };

  list = async (namespace: string): Promise<ToolCatalogEntry[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.list(namespace);
  };

  upsert = async (namespace: string, entry: ToolCatalogEntry): Promise<ToolCatalogEntry> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.upsert(namespace, entry);
  };

  delete = async (namespace: string, entryId: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.delete(namespace, entryId);
  };
}
