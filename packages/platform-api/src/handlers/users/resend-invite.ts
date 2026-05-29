import { assertCallerIsNamespaceAdmin } from '../../auth';
import { HandlerError, PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { ResendInviteInput, ResendInviteOutput } from '../../contract/users';
import { actorFromCaller } from '../_helpers';

/**
 * Re-issue an invite for a pending workspace member.
 *
 *   1. Caller must be `owner`/`admin` of `namespaceHandle` (apiKey bypass).
 *   2. Look up the target user's email via
 *      `scope.system.inviteService.getUserEmail`. Missing email → `validation`.
 *   3. Refuse if the invite isn't pending anymore — `isInvitePending` returns
 *      `false` once `mustChangePassword` is cleared AND the user has signed
 *      in. Active users keep their password; this guard prevents an admin
 *      from accidentally locking a colleague out.
 *   4. Rotate the temporary password via
 *      `scope.system.inviteService.resetInvitePassword` and (best-effort)
 *      deliver it via `scope.system.inviteNotificationService.sendInviteEmail`.
 *      Email failures don't fail the response — `emailSent` flips to `false`
 *      so the admin can hand the password over manually.
 *   5. Append `invitation.resent` to the audit log.
 *
 * `scope.system.inviteService === null` → `PreconditionFailedError` — same
 * shape as `inviteUser` for an unconfigured deployment.
 */
export async function resendInvite(
  input: ResendInviteInput,
  scope: CallerScope,
): Promise<ResendInviteOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespaceHandle);

  const invite = scope.system.inviteService;
  if (invite === null) {
    throw new PreconditionFailedError('Invite service is not configured');
  }

  const email = await invite.getUserEmail(input.uid);
  if (email === null) {
    throw new HandlerError('validation', 'User has no email address');
  }

  const pending = await invite.isInvitePending(input.uid);
  if (!pending) {
    throw new PreconditionFailedError(
      'Cannot resend invite: user has already activated their account',
    );
  }

  const temporaryPassword = await invite.resetInvitePassword(input.uid);

  let emailSent = false;
  const notify = scope.system.inviteNotificationService;
  if (notify !== null) {
    try {
      await notify.sendInviteEmail({ toEmail: email, temporaryPassword });
      emailSent = true;
    } catch (emailErr) {
      console.error('[resend-invite] Failed to send email:', emailErr);
      emailSent = false;
    }
  }

  await scope.system.audit.append({
    ...actorFromCaller(scope),
    action: 'invitation.resent',
    description: `Invite resent for user '${input.uid}' in namespace '${input.namespaceHandle}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      uid: input.uid,
      namespaceHandle: input.namespaceHandle,
    },
    outputSnapshot: { uid: input.uid, emailSent },
    basis: 'Invite resent via API',
    entityType: 'invitation',
    entityId: input.uid,
    namespace: input.namespaceHandle,
  });

  return { uid: input.uid, email, temporaryPassword, emailSent };
}
