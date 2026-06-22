import { assertCallerIsNamespaceAdmin } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { UpdateToolCatalogEntryInputApi, UpdateToolCatalogEntryOutput } from '../../contract/tool-catalog';
import { actorFromCaller } from '../_helpers';

export async function updateToolCatalogEntry(
  input: UpdateToolCatalogEntryInputApi,
  scope: CallerScope,
): Promise<UpdateToolCatalogEntryOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const { namespace, id, ...patch } = input;

  const existing = await scope.toolCatalog.getById(namespace, id);
  if (existing === null) {
    throw new NotFoundError(`Tool catalog entry '${id}' not found`);
  }

  const merged = { ...existing, ...patch, id };
  const entry = await scope.toolCatalog.upsert(namespace, merged);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'tool_catalog_entry.updated',
    description: `Tool catalog entry '${id}' updated in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, id, patchKeys: Object.keys(patch) },
    outputSnapshot: { id: entry.id },
    basis: 'Tool catalog entry updated via API',
    entityType: 'toolCatalogEntry',
    entityId: entry.id,
    namespace,
  });

  return { entry };
}
