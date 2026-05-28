import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../errors.js';

import type { CallerScope } from '../../repositories/index.js';
import type {
  LeaveNamespaceInput,
  LeaveNamespaceOutput,
} from '../../contract/namespaces.js';

/**
 * Caller removes self from a workspace. Owner is blocked because there is
 * no ownership-transfer flow yet — delete the workspace instead.
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

  const member = await scope.workspaces.getMember(input.handle, uid);
  if (member === null) {
    // Anti-enum: same 404 a non-member would see on GET — don't leak that the
    // caller was-never-a-member vs. namespace-doesn't-exist.
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  // Owner block also covers personal namespaces — the linked user is always
  // the personal namespace's owner, so no second `type === 'personal'`
  // branch is needed.
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
