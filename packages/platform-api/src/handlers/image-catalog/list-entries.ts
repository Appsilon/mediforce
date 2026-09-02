import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListImageCatalogEntriesInput,
  ListImageCatalogEntriesOutput,
} from '../../contract/image-catalog';
import { toEntryViews } from './_view';

export async function listImageCatalogEntries(
  input: ListImageCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListImageCatalogEntriesOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const entries = await scope.imageCatalog.list(input.namespace);
  return { entries: await toEntryViews(entries, scope) };
}
