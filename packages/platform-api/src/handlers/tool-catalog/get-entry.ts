import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  GetToolCatalogEntryInput,
  GetToolCatalogEntryOutput,
} from '../../contract/tool-catalog.js';

export async function getToolCatalogEntry(
  input: GetToolCatalogEntryInput,
  scope: CallerScope,
): Promise<GetToolCatalogEntryOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const entry = await scope.toolCatalog.getById(input.namespace, input.id);
  if (entry === null) {
    throw new NotFoundError(`Tool catalog entry '${input.id}' not found`);
  }
  return { entry };
}
