import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListToolCatalogEntriesInput,
  ListToolCatalogEntriesOutput,
} from '../../contract/tool-catalog';

/** Every member of the namespace reads whole entries — any member may create
 *  and edit them, so hiding fields from members would protect nothing.
 *  Secrets belong in `{{SECRET:name}}` references, never literal values. */
export async function listToolCatalogEntries(
  input: ListToolCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListToolCatalogEntriesOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  return { entries: await scope.toolCatalog.list(input.namespace) };
}
