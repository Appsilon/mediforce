import { ToolCatalogEntrySchema } from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import { HandlerError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  CreateToolCatalogEntryInputApi,
  CreateToolCatalogEntryOutput,
} from '../../contract/tool-catalog';
import { actorFromCaller } from '../_helpers';
import { slugifyCommand, slugifyUrl } from './_helpers';

export async function createToolCatalogEntry(
  input: CreateToolCatalogEntryInputApi,
  scope: CallerScope,
): Promise<CreateToolCatalogEntryOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const { namespace, ...rest } = input;

  const derivedId =
    typeof rest.id === 'string' && rest.id.length > 0
      ? rest.id
      : rest.type === 'stdio'
        ? slugifyCommand(rest.command)
        : slugifyUrl(rest.url);
  if (derivedId === '') {
    throw new HandlerError(
      'validation',
      'Unable to derive id: supply `id`, a non-empty `command` or a valid `url`.',
    );
  }

  const parsed = ToolCatalogEntrySchema.safeParse({ ...rest, id: derivedId });
  if (!parsed.success) {
    throw new HandlerError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Invalid input',
      parsed.error.issues,
    );
  }

  const existing = await scope.toolCatalog.getById(namespace, derivedId);
  if (existing !== null) {
    throw new HandlerError(
      'conflict',
      `Tool catalog entry "${derivedId}" already exists in namespace "${namespace}".`,
    );
  }

  const entry = await scope.toolCatalog.upsert(namespace, parsed.data);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'tool_catalog_entry.created',
    description: `Tool catalog entry '${entry.id}' created in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot:
      entry.type === 'stdio'
        ? { namespace, id: entry.id, type: entry.type, command: entry.command, args: entry.args }
        : { namespace, id: entry.id, type: entry.type, url: entry.url },
    outputSnapshot: { id: entry.id },
    basis: 'Tool catalog entry created via API',
    entityType: 'toolCatalogEntry',
    entityId: entry.id,
    namespace,
  });

  return { entry };
}
