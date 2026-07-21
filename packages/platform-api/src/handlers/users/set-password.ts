import { compare, hash } from 'bcryptjs';
import { emitAudit } from '../../audit-helpers';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../errors';
import type { CallerScope } from '../../repositories/index';
import { resolvePersonalNamespace } from '../_helpers';
import type { SetPasswordInput, SetPasswordOutput } from '../../contract/users';

const BCRYPT_COST = 12;

/**
 * Set a user's password (ADR-0002 §4). bcrypt-hashes the plaintext here so no
 * hash-shape knowledge leaks into the route or the repository, then writes it
 * through the `credentials` port. User callers always operate on their own
 * uid; apiKey callers must pass `uid` explicitly.
 *
 * Two guarantees carried over from the Firebase `updatePassword` this replaced:
 *
 *  1. Re-authentication. A user caller replacing an EXISTING password must
 *     prove the old one (`currentPassword`), so a stolen session cookie cannot
 *     be upgraded into a permanent credential. Deliberately asymmetric: when
 *     the target has no hash yet (invite / first-time set) there is nothing to
 *     re-authenticate against, and an apiKey caller (admin/system path) is
 *     trusted by the auth boundary and never knows the user's password.
 *  2. Session revocation. Every OTHER session of the target user is deleted on
 *     success — the change kicks the attacker's device — while the caller's own
 *     session survives so they are not bounced out of the flow.
 *
 * Clearing `mustChangePassword` stays a separate call — the change-password
 * page makes it after this one succeeds.
 */
export async function setPassword(
  input: SetPasswordInput,
  scope: CallerScope,
): Promise<SetPasswordOutput> {
  const uid = resolveUid(input, scope);

  await assertReauthenticated(input, scope, uid);

  const passwordHash = await hash(input.newPassword, BCRYPT_COST);
  const updated = await scope.credentials.setPasswordHash(uid, passwordHash);
  if (updated === false) {
    throw new NotFoundError(`User '${uid}' not found`);
  }

  // Keep the caller's own session when it is the user changing their own
  // password; an apiKey reset keeps nothing, which is the intended admin
  // "sign this account out everywhere" semantic.
  const keepSessionToken =
    scope.caller.kind === 'user' && scope.caller.uid === uid
      ? scope.caller.sessionToken ?? null
      : null;
  await scope.credentials.deleteSessions(uid, keepSessionToken);

  const namespace = await resolvePersonalNamespace(scope, uid);
  if (namespace === null) {
    throw new PreconditionFailedError(
      `Cannot attribute password-set audit event to a workspace: user '${uid}' has no namespace.`,
    );
  }

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'user.password_set',
    description: `Password set for user '${uid}'`,
    // Snapshots carry the uid only — never the plaintext password or its hash.
    inputSnapshot: { uid },
    outputSnapshot: { uid },
    basis: 'User set a new password',
    entityType: 'user',
    entityId: uid,
    namespace,
  });

  return { user: { uid } };
}

/**
 * Enforce the re-authentication rule described on `setPassword`. Throws before
 * anything is written, so a wrong `currentPassword` leaves the stored hash and
 * every session untouched.
 */
async function assertReauthenticated(
  input: SetPasswordInput,
  scope: CallerScope,
  uid: string,
): Promise<void> {
  // apiKey callers are the admin/system path — no user password to present.
  if (scope.caller.kind !== 'user') return;

  const existingHash = await scope.credentials.getPasswordHash(uid);
  // First-time set (invite, `mustChangePassword` on a seeded account,
  // OAuth-only user adding a password): nothing to re-authenticate against.
  if (existingHash === null) return;

  if (input.currentPassword === undefined) {
    throw new ValidationError(
      'currentPassword is required to replace an existing password',
    );
  }
  if ((await compare(input.currentPassword, existingHash)) === false) {
    throw new ForbiddenError('Current password is incorrect');
  }
}

function resolveUid(input: SetPasswordInput, scope: CallerScope): string {
  if (scope.caller.kind === 'user') {
    if (input.uid !== undefined && input.uid !== scope.caller.uid) {
      throw new ForbiddenError('Cannot set another user’s password');
    }
    return scope.caller.uid;
  }
  if (input.uid === undefined) {
    throw new ValidationError(
      'apiKey caller must pass `uid` to POST /api/users/set-password — there is no implicit identity for system actors',
    );
  }
  return input.uid;
}
