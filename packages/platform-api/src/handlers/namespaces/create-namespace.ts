import { WORKFLOW_MANAGER_ROLE, type Namespace, type NamespaceMember } from '@mediforce/platform-core';
import { ConflictError, ForbiddenError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  CreateNamespaceInput,
  CreateNamespaceOutput,
} from '../../contract/namespaces';

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

  // Pull the caller's `auth_users` profile name so the owner member doc
  // carries a human-readable `displayName` from day one. Without this, the
  // members list would show the owner's uid until they re-invited themselves.
  // Best-effort: directory unconfigured or lookup failure → no displayName.
  const callerMetadata = scope.system.userDirectory !== null
    ? await scope.system.userDirectory.getUserMetadata(uid).catch(() => null)
    : null;
  const ownerDisplayName = typeof callerMetadata?.displayName === 'string' && callerMetadata.displayName.length > 0
    ? callerMetadata.displayName
    : undefined;

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
    ...(ownerDisplayName !== undefined ? { displayName: ownerDisplayName } : {}),
  };

  await scope.workspaces.createNamespaceWithOwner({ namespace, ownerMember });

  // ADR-0020: the owner holds `workflow-manager` from the first minute, so the
  // default access every workflow created here is seeded with has somebody who
  // can pass it. Without this the first person to create a workflow would be
  // its only manager and the owner could not touch it.
  //
  // Best-effort, and reported in the audit entry rather than swallowed: the
  // workspace is already written by now, so failing the request would leave a
  // real workspace behind a 500 and a retry that can only 409.
  const ownerRoleGranted = scope.system.userDirectory === null
    ? false
    : await scope.system.userDirectory
        .grantRole(uid, input.handle, { role: WORKFLOW_MANAGER_ROLE, workflowName: null })
        .then(() => true)
        .catch(() => false);

  await scope.system.audit.append({
    actorId: uid,
    actorType: 'user',
    actorRole: 'operator',
    action: 'namespace.created',
    description: `User '${uid}' created namespace '${input.handle}'`,
    timestamp: now,
    inputSnapshot: { handle: input.handle, displayName: input.displayName },
    outputSnapshot: { handle: input.handle, type: 'organization', ownerRoleGranted },
    basis: 'User created workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
    namespace: input.handle,
  });

  return { namespace };
}
