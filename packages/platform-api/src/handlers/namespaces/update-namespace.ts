import type { NamespaceUpdates } from '@mediforce/platform-core';
import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  UpdateNamespaceInput,
  UpdateNamespaceOutput,
} from '../../contract/namespaces.js';

/**
 * Edit workspace `displayName`, `bio`, `icon`. Owner/admin only.
 * `bio: null` clears the field via the repo's null-sentinel semantics.
 */
export async function updateNamespace(
  input: UpdateNamespaceInput,
  scope: CallerScope,
): Promise<UpdateNamespaceOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.handle);

  const existing = await scope.workspaces.getNamespace(input.handle);
  if (existing === null) {
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  const updates: NamespaceUpdates = {
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(input.bio !== undefined ? { bio: input.bio } : {}),
  };

  await scope.workspaces.updateNamespace(input.handle, updates);

  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) {
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  const now = new Date().toISOString();
  await scope.system.audit.append({
    actorId: scope.caller.kind === 'user' ? scope.caller.uid : 'system',
    actorType: scope.caller.kind === 'user' ? 'user' : 'system',
    actorRole: scope.caller.kind === 'user' ? 'operator' : 'system',
    action: 'namespace.updated',
    description: `Namespace '${input.handle}' updated`,
    timestamp: now,
    inputSnapshot: {
      handle: input.handle,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
    },
    outputSnapshot: { handle: namespace.handle, displayName: namespace.displayName },
    basis: 'Owner/admin edited workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
  });

  return { namespace };
}
