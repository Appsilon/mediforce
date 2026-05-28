import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  LeaveNamespaceInput,
  LeaveNamespaceOutput,
} from '../../contract/namespaces.js';

/**
 * POST /api/namespaces/:handle/leave — caller removes self from a workspace.
 *
 * Atomic: deletes the caller's member doc AND arrayRemoves the handle from
 * `users/{uid}.organizations` in one batch.
 *
 * - Owner is blocked: returns `precondition_failed` (HTTP 409 per ADR-0005
 *   §3) with a hint to delete the workspace instead. Ownership-transfer is
 *   not yet a first-class operation; until it lands, deleting the workspace
 *   is the only path off owner role.
 * - Personal namespaces are blocked: the personal namespace is the user's
 *   identity bucket and is created by GET /api/users/me bootstrap; leaving
 *   it is meaningless.
 * - apiKey callers rejected — there is no `self` to leave for a system actor.
 *
 * Emits `namespace.member_left` per ADR-0005 §7.
 */
export async function leaveNamespace(
  input: LeaveNamespaceInput,
  scope: CallerScope,
): Promise<LeaveNamespaceOutput> {
  if (scope.caller.kind !== 'user') {
    throw new ForbiddenError(
      'POST /api/namespaces/:handle/leave requires an authenticated user (no "self" for apiKey callers)',
    );
  }
  const uid = scope.caller.uid;

  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) {
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  if (namespace.type === 'personal') {
    throw new PreconditionFailedError(
      'Cannot leave your personal namespace. Personal namespaces are bound to your account.',
      { handle: input.handle, type: 'personal' },
    );
  }

  const member = await scope.workspaces.getMember(input.handle, uid);
  if (member === null) {
    // Anti-enum: same 404 a non-member would see on GET — don't leak that the
    // caller was-never-a-member vs. namespace-doesn't-exist.
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  if (member.role === 'owner') {
    throw new PreconditionFailedError(
      'Workspace owner cannot leave their own workspace. Delete the workspace instead, or have ownership transferred first.',
      { handle: input.handle, role: 'owner' },
    );
  }

  await scope.workspaces.removeMemberWithOrganizations(input.handle, uid);

  const now = new Date().toISOString();
  await scope.system.audit.append({
    actorId: uid,
    actorType: 'user',
    actorRole: 'operator',
    action: 'namespace.member_left',
    description: `User '${uid}' left namespace '${input.handle}'`,
    timestamp: now,
    inputSnapshot: { handle: input.handle, uid },
    outputSnapshot: { handle: input.handle, uid, removedRole: member.role },
    basis: 'User left workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
  });

  return { handle: input.handle };
}
