import type {
  ImageCatalogEntry,
  ImageCatalogRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped view of `ImageCatalogRepository`. Entries are per-namespace
 * rows, so the namespace is a required argument on every method; the wrapper
 * asserts membership before delegating.
 *
 * Membership is the whole gate — unlike the Tool Catalog there is no admin
 * step above it, because an entry executes nothing (ADR-0021 decision 3).
 */
export class AuthorizedImageCatalogRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: ImageCatalogRepository,
  ) {
    super(caller);
  }

  getById = async (namespace: string, entryId: string): Promise<ImageCatalogEntry | null> => {
    if (!this.canSeeNamespace(namespace)) return null;
    return this.raw.getById(namespace, entryId);
  };

  list = async (namespace: string): Promise<ImageCatalogEntry[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.list(namespace);
  };

  upsert = async (namespace: string, entry: ImageCatalogEntry): Promise<ImageCatalogEntry> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.upsert(namespace, entry);
  };

  delete = async (namespace: string, entryId: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.delete(namespace, entryId);
  };
}
