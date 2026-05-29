import { ToolCatalogEntrySchema } from '@mediforce/platform-core';
import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { HandlerError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  CreateToolCatalogEntryInputApi,
  CreateToolCatalogEntryOutput,
} from '../../contract/tool-catalog.js';
import { actorFromCaller } from '../_helpers.js';
import { slugifyCommand } from './_helpers.js';

export async function createToolCatalogEntry(
  input: CreateToolCatalogEntryInputApi,
  scope: CallerScope,
): Promise<CreateToolCatalogEntryOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const { namespace, ...rest } = input;

  const derivedId =
    typeof rest.id === 'string' && rest.id.length > 0
      ? rest.id
      : typeof rest.command === 'string'
        ? slugifyCommand(rest.command)
        : '';
  if (derivedId === '') {
    throw new HandlerError(
      'validation',
      'Unable to derive id: supply `id` or a non-empty `command`.',
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
    inputSnapshot: {
      namespace,
      id: entry.id,
      command: entry.command,
      args: entry.args,
    },
    outputSnapshot: { id: entry.id },
    basis: 'Tool catalog entry created via API',
    entityType: 'toolCatalogEntry',
    entityId: entry.id,
  });

  return { entry };
}
