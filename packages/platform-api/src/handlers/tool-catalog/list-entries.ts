import { assertCallerIsNamespaceAdmin } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListToolCatalogEntriesInput,
  ListToolCatalogEntriesOutput,
} from '../../contract/tool-catalog';

export async function listToolCatalogEntries(
  input: ListToolCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListToolCatalogEntriesOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const entries = await scope.toolCatalog.list(input.namespace);
  return { entries };
}
