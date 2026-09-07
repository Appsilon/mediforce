import { assertCallerIsNamespaceAdmin } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type { InviteUserInput, InviteUserOutput } from '../../contract/users';
import { actorFromCaller } from '../_helpers';
import { seedMemberAndNotify } from './seed-member';

/**
 * Invite a user to a workspace.
 *
 * Seed-based model (PLAN-0002 §3.1, on the ADR-0002 §4b verified-email
 * auto-link) — replaces the legacy Firebase temp-password
 * flow:
 *
 *   1. Caller must be `owner`/`admin` of `namespaceHandle` (apiKey bypass).
 *   2. `seedMemberAndNotify` writes the `auth_users` row + the workspace
 *      membership in one transaction, gates a pending invitee into the
 *      create-password flow where password auth is on, and sends the
 *      activation email (or the plain workspace notification for an already
 *      active user). Shared verbatim with `redeemJoinLink` — ADR-0021 §4 makes
 *      a join-link redemption the same seed and the same email as this.
 *   3. Append `invitation.created` to the audit log.
 *
 * `scope.system.inviteService === null` → `PreconditionFailedError` (the
 * deployment isn't wired for invites — surface clearly rather than 500).
 */
export async function inviteUser(
  input: InviteUserInput,
  scope: CallerScope,
): Promise<InviteUserOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespaceHandle);

  const email = input.email.trim().toLowerCase();
  const displayName =
    typeof input.displayName === 'string' && input.displayName.trim() !== ''
      ? input.displayName.trim()
      : undefined;

  const { uid, isExisting, emailSent } = await seedMemberAndNotify(
    {
      email,
      ...(displayName !== undefined ? { displayName } : {}),
      namespaceHandle: input.namespaceHandle,
      membership: input.role,
      ...(input.inviterName !== undefined ? { inviterName: input.inviterName } : {}),
    },
    scope,
  );

  await scope.system.audit.append({
    ...actorFromCaller(scope),
    action: 'invitation.created',
    description: `User '${email}' invited to namespace '${input.namespaceHandle}' as ${input.role}`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      email,
      namespaceHandle: input.namespaceHandle,
      role: input.role,
      ...(displayName !== undefined ? { displayName } : {}),
    },
    outputSnapshot: { uid, isExisting, emailSent },
    basis: 'User invited via API',
    entityType: 'invitation',
    entityId: uid,
    namespace: input.namespaceHandle,
  });

  return { uid, email, emailSent, isExisting };
}
