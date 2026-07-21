import { hash } from 'bcryptjs';
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
 * Clearing `mustChangePassword` stays a separate call — the change-password
 * page makes it after this one succeeds.
 */
export async function setPassword(
  input: SetPasswordInput,
  scope: CallerScope,
): Promise<SetPasswordOutput> {
  const uid = resolveUid(input, scope);

  const passwordHash = await hash(input.newPassword, BCRYPT_COST);
  const updated = await scope.credentials.setPasswordHash(uid, passwordHash);
  if (updated === false) {
    throw new NotFoundError(`User '${uid}' not found`);
  }

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
