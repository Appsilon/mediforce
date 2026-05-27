import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  ListToolCatalogEntriesInput,
  ListToolCatalogEntriesOutput,
} from '../../contract/tool-catalog.js';

export async function listToolCatalogEntries(
  input: ListToolCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListToolCatalogEntriesOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const entries = await scope.toolCatalog.list(input.namespace);
  return { entries };
}
