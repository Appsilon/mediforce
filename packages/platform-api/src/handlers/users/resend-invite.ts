import { assertCallerIsNamespaceAdmin } from '../../auth';
import { HandlerError, PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { ResendInviteInput, ResendInviteOutput } from '../../contract/users';
import { actorFromCaller, resolveConfiguredBaseUrl } from '../_helpers';

/**
 * Re-send the workspace-notification email for a pending workspace member
 * (seed-based model, PLAN-0002 §3.1).
 *
 *   1. Caller must be `owner`/`admin` of `namespaceHandle` (apiKey bypass).
 *   2. Look up the target user's email via
 *      `scope.system.inviteService.getUserEmail`. Missing email → `validation`.
 *   3. Refuse if the invite isn't pending anymore — `isInvitePending` returns
 *      `false` once the invitee has a session or has set a password. This guard
 *      stops an admin from re-notifying a colleague who is already active.
 *   4. Re-send the workspace-notification email (best-effort) via
 *      `scope.system.inviteNotificationService.sendWorkspaceNotificationEmail`.
 *      There is no temp password to rotate in the seed-based model. Email
 *      failures don't fail the response — `emailSent` flips to `false`.
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

  let emailSent = false;
  const notify = scope.system.inviteNotificationService;
  if (notify !== null) {
    try {
      const baseUrl = await resolveConfiguredBaseUrl(scope);
      const namespace = await scope.workspaces.getNamespace(input.namespaceHandle);
      const workspaceName = namespace?.displayName ?? input.namespaceHandle;
      await notify.sendWorkspaceNotificationEmail({
        toEmail: email,
        inviterName: workspaceName,
        workspaceName,
        workspaceHandle: input.namespaceHandle,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      });
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

  return { uid: input.uid, email, emailSent };
}
