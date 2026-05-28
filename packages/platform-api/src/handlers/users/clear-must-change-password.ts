import { emitAudit } from '../../audit-helpers.js';
import { ForbiddenError, ValidationError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  ClearMustChangePasswordInput,
  ClearMustChangePasswordOutput,
} from '../../contract/users.js';

/**
 * Acknowledge a forced password change. User callers always operate on
 * their own uid; apiKey callers must pass `uid` explicitly.
 */
export async function clearMustChangePassword(
  input: ClearMustChangePasswordInput,
  scope: CallerScope,
): Promise<ClearMustChangePasswordOutput> {
  const uid = resolveUid(input, scope);

  await scope.userProfiles.setMustChangePassword(uid, false);

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'user.password_change_acknowledged',
    description: `User '${uid}' acknowledged forced password change`,
    inputSnapshot: { uid },
    outputSnapshot: { uid, mustChangePassword: false },
    basis: 'User completed forced password change',
    entityType: 'user',
    entityId: uid,
  });

  return { user: { uid, mustChangePassword: false } };
}

function resolveUid(input: ClearMustChangePasswordInput, scope: CallerScope): string {
  if (scope.caller.kind === 'user') {
    if (input.uid !== undefined && input.uid !== scope.caller.uid) {
      throw new ForbiddenError('Cannot clear another user’s mustChangePassword flag');
    }
    return scope.caller.uid;
  }
  if (input.uid === undefined) {
    throw new ValidationError(
      'apiKey caller must pass `uid` to POST /api/users/me/clear-must-change-password — there is no implicit identity for system actors',
    );
  }
  return input.uid;
}
