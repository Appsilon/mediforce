import { assertNamespaceAccess, callerIsNamespaceAdmin } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListToolCatalogEntriesInput,
  ListToolCatalogEntriesOutput,
} from '../../contract/tool-catalog';

/**
 * Admins read whole entries. Other members of the namespace read each entry
 * without `args` and `env`: a workflow author needs the command to be warned
 * when a step's image lacks it, but launch arguments and environment are the
 * admin's to see — they can carry credentials.
 */
export async function listToolCatalogEntries(
  input: ListToolCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListToolCatalogEntriesOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const entries = await scope.toolCatalog.list(input.namespace);
  if (callerIsNamespaceAdmin(scope.caller, input.namespace)) return { entries };
  return {
    entries: entries.map(({ id, command, description }) => ({ id, command, description })),
  };
}
