import { assertCallerIsNamespaceAdmin } from '../../auth';
import { HandlerError, PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { ResendInviteInput, ResendInviteOutput } from '../../contract/users';
import { actorFromCaller, resolveConfiguredBaseUrl } from '../_helpers';

/**
 * Re-send a fresh activation email for a pending workspace member — the
 * expired-invite recovery path (seed-based model, PLAN-0002 §3.1).
 *
 *   1. Caller must be `owner`/`admin` of `namespaceHandle` (apiKey bypass).
 *   2. Look up the target user's email via
 *      `scope.system.inviteService.getUserEmail`. Missing email → `validation`.
 *   3. Refuse if the invite isn't pending anymore — `isInvitePending` returns
 *      `false` once the invitee has a session or has set a password. This guard
 *      stops an admin from re-notifying a colleague who is already active.
 *   4. When password auth is enabled (`scope.system.passwordAuthEnabled`),
 *      re-arm the create-password gate (`setMustChangePassword`) and send a
 *      fresh activation email with a new one-time 7-day sign-in link
 *      (best-effort) via `scope.system.inviteNotificationService`. Otherwise no
 *      gate is armed and the plain workspace-notification email goes out
 *      instead — the invitee signs in with their configured provider. Email
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

  // Same gate as `inviteUser`: the create-password flow is only the right
  // recovery when password auth is the intended first-credential method. On a
  // Google/OIDC-only or magic-link-only deployment the activation link lands the
  // invitee on a `/change-password` page they cannot complete, so the resend
  // falls back to the plain workspace notification — sign in with the provider.
  const resendPasswordSetup = scope.system.passwordAuthEnabled === true;
  if (resendPasswordSetup) {
    // Re-arm the create-password gate — cheap insurance the flag is set even for
    // a pending row seeded before the gate existed.
    await scope.userProfiles.setMustChangePassword(input.uid, true);
  }

  let emailSent = false;
  const notify = scope.system.inviteNotificationService;
  if (notify !== null) {
    try {
      const baseUrl = await resolveConfiguredBaseUrl(scope);
      const namespace = await scope.workspaces.getNamespace(input.namespaceHandle);
      const workspaceName = namespace?.displayName ?? input.namespaceHandle;
      const payload = {
        toEmail: email,
        inviterName: workspaceName,
        workspaceName,
        workspaceHandle: input.namespaceHandle,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      };
      if (resendPasswordSetup) {
        await notify.sendActivationEmail(payload);
      } else {
        await notify.sendWorkspaceNotificationEmail(payload);
      }
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
