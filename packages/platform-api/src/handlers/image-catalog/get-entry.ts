import { assertNamespaceAccess } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  GetImageCatalogEntryInput,
  GetImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { toEntryViews } from './_view';

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
  const [view] = await toEntryViews([entry], scope);
  return { entry: view };
}
