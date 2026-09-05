import { assertNamespaceAccess } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  GetImageCatalogEntryInput,
  GetImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { toEntryView } from './_view';
import { withBuildSteps } from './_lineage';

export async function getImageCatalogEntry(
  input: GetImageCatalogEntryInput,
  scope: CallerScope,
): Promise<GetImageCatalogEntryOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const entry = await scope.imageCatalog.getById(input.namespace, input.id);
  if (entry === null) {
    throw new NotFoundError(`Image catalog entry '${input.id}' not found`);
  }
  // An entry whose image is gone from the daemon is not a 404: the sentence
  // someone wrote about it is still the answer to "what was this for?".
  const view = await toEntryView(input.namespace, entry, scope);
  // The layer delta costs a `docker history` per version, so it is attached
  // here and not on the listing — one entry at a time is what it is for.
  return { entry: await withBuildSteps(view) };
}
