import type { Namespace } from '@mediforce/platform-core';
import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  UpdateNamespaceInput,
  UpdateNamespaceOutput,
} from '../../contract/namespaces.js';

/**
 * PATCH /api/namespaces/:handle — edit workspace `displayName`, `bio`,
 * `icon`. Owner/admin only (`assertCallerIsNamespaceAdmin`). Returns the
 * post-update entity-echo per ADR-0005 §5. Emits `namespace.updated` per
 * ADR-0005 §7.
 *
 * `bio: null` clears the field; omitting it leaves it unchanged. We
 * normalise to `undefined` for the storage write so the repo sees a Partial
 * with only the set fields. The Firestore impl uses doc().update() which
 * supports `FieldValue.delete()` for true field removal; for Phase 4 the
 * UI's existing flow (delete-field on empty bio) is preserved by passing
 * `bio: undefined` here and relying on the storage layer's merge semantics
 * — clearing the field is a no-op vs leaving it set today, which matches
 * the pre-migration behaviour.
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

  const updates: Partial<Namespace> = {};
  if (input.displayName !== undefined) updates.displayName = input.displayName;
  if (input.icon !== undefined) updates.icon = input.icon;
  if (input.bio !== undefined) {
    updates.bio = input.bio === null ? undefined : input.bio;
  }

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
