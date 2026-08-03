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
 *   4. Always send a fresh one-time 7-day sign-in link (best-effort) via
 *      `scope.system.inviteNotificationService` — the invitee has no session
 *      by definition. Only when password auth is enabled
 *      (`scope.system.passwordAuthEnabled`) is the create-password gate
 *      re-armed (`setMustChangePassword`) and the link framed as account
 *      setup. Email failures don't fail the response — `emailSent` flips to
 *      `false`.
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
  // Google/OIDC-only or magic-link-only deployment it would land the invitee on
  // a `/change-password` page they cannot complete.
  const passwordSetupEnabled = scope.system.passwordAuthEnabled === true;
  if (passwordSetupEnabled) {
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
      // A pending invitee has no session yet, so the recovery must always carry
      // a way in — a one-time sign-in link, same as the self-service
      // `/api/auth/resend-setup-link` path. With password auth off the link
      // simply signs them in instead of landing on create-password.
      await notify.sendActivationEmail({
        toEmail: email,
        workspaceName,
        workspaceHandle: input.namespaceHandle,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        passwordSetupEnabled,
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
