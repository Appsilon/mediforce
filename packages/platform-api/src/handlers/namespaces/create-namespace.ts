import type { Namespace, NamespaceMember } from '@mediforce/platform-core';
import { ConflictError, ForbiddenError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  CreateNamespaceInput,
  CreateNamespaceOutput,
} from '../../contract/namespaces.js';

/**
 * Create an organization workspace. Atomic write of namespace doc + owner
 * member doc + denormalised `users/{uid}.organizations`. Emits
 * `namespace.created` via the handler-bridge per ADR-0005 §7.
 *
 * Any authenticated user may create; spam/multi-tenancy gating is out of
 * scope until a real abuse signal exists. apiKey callers are rejected — a
 * workspace without a human owner is unreachable through the UI.
 */
export async function createNamespace(
  input: CreateNamespaceInput,
  scope: CallerScope,
): Promise<CreateNamespaceOutput> {
  if (scope.caller.kind !== 'user') {
    throw new ForbiddenError(
      'POST /api/namespaces requires an authenticated user (owner has no uid otherwise)',
    );
  }
  const uid = scope.caller.uid;

  const existing = await scope.workspaces.getNamespace(input.handle);
  if (existing !== null) {
    throw new ConflictError(`Namespace handle '${input.handle}' is already taken`);
  }

  const now = new Date().toISOString();
  const namespace: Namespace = {
    handle: input.handle,
    type: 'organization',
    displayName: input.displayName,
    createdAt: now,
    ...(input.bio !== undefined ? { bio: input.bio } : {}),
  };
  const ownerMember: NamespaceMember = {
    uid,
    role: 'owner',
    joinedAt: now,
  };

  await scope.workspaces.createNamespaceWithOwner({ namespace, ownerMember });

  await scope.system.audit.append({
    actorId: uid,
    actorType: 'user',
    actorRole: 'operator',
    action: 'namespace.created',
    description: `User '${uid}' created namespace '${input.handle}'`,
    timestamp: now,
    inputSnapshot: { handle: input.handle, displayName: input.displayName },
    outputSnapshot: { handle: input.handle, type: 'organization' },
    basis: 'User created workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
  });

  return { namespace };
}
