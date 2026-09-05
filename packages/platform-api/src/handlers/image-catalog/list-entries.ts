import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListImageCatalogEntriesInput,
  ListImageCatalogEntriesOutput,
} from '../../contract/image-catalog';
import { toEntryViews } from './_view';
import { orderByLineage } from './_lineage';

export async function listImageCatalogEntries(
  input: ListImageCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListImageCatalogEntriesOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const entries = await scope.imageCatalog.list(input.namespace);
  // Grouped by base rather than listed flat: the estate is a tree — the golden
  // image and everything built on it — and four unrelated rows is what the
  // catalog exists to stop showing (ADR-0021 decision 2, #1296).
  return { entries: orderByLineage(await toEntryViews(entries, scope)) };
}
