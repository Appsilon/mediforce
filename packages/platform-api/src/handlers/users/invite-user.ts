import { assertCallerIsNamespaceAdmin } from '../../auth';
import { PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { InviteUserInput, InviteUserOutput } from '../../contract/users';
import { actorFromCaller, resolveConfiguredBaseUrl } from '../_helpers';

/**
 * Invite a user to a workspace.
 *
 * Seed-based model (PLAN-0002 §3.1, on the ADR-0002 §4b verified-email
 * auto-link) — replaces the legacy Firebase temp-password
 * flow:
 *
 *   1. Caller must be `owner`/`admin` of `namespaceHandle` (apiKey bypass).
 *   2. Pre-seed the invitee via `scope.system.inviteService.seedInvite`: it
 *      writes the `auth_users` row + the workspace membership + any global
 *      roles in one transaction. No temp password is issued; `isExisting` is
 *      `true` when the account already existed (idempotent on email collision).
 *   3. Best-effort workspace-notification email via
 *      `scope.system.inviteNotificationService`. The invitee signs in later via
 *      Google (verified-email auto-link) or by setting a password — there is no
 *      credentials email. Email failures don't fail the response — `emailSent`
 *      flips to `false`.
 *   4. Append `invitation.created` to the audit log.
 *
 * `scope.system.inviteService === null` → `PreconditionFailedError` (the
 * deployment isn't wired for invites — surface clearly rather than 500).
 */
export async function inviteUser(
  input: InviteUserInput,
  scope: CallerScope,
): Promise<InviteUserOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespaceHandle);

  const invite = scope.system.inviteService;
  if (invite === null) {
    throw new PreconditionFailedError('Invite service is not configured');
  }

  const email = input.email.trim().toLowerCase();
  const displayName =
    typeof input.displayName === 'string' && input.displayName.trim() !== ''
      ? input.displayName.trim()
      : undefined;

  const { uid, isExisting } = await invite.seedInvite({
    email,
    ...(displayName !== undefined ? { displayName } : {}),
    workspaceHandle: input.namespaceHandle,
    membership: input.role,
    roles: [],
  });

  let emailSent = false;
  const notify = scope.system.inviteNotificationService;
  if (notify !== null) {
    try {
      const baseUrl = await resolveConfiguredBaseUrl(scope);
      const namespace = await scope.workspaces.getNamespace(input.namespaceHandle);
      const workspaceName = namespace?.displayName ?? input.namespaceHandle;
      const inviterName =
        typeof input.inviterName === 'string' && input.inviterName.trim() !== ''
          ? input.inviterName.trim()
          : workspaceName;
      await notify.sendWorkspaceNotificationEmail({
        toEmail: email,
        inviterName,
        workspaceName,
        workspaceHandle: input.namespaceHandle,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      });
      emailSent = true;
    } catch (emailErr) {
      console.error('[invite-user] Failed to send email:', emailErr);
      emailSent = false;
    }
  }

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
