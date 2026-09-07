import { PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import { resolveConfiguredBaseUrl } from '../_helpers';

/**
 * Seed an account into a workspace and tell them about it — the one path by
 * which somebody becomes a member without already having a session.
 *
 * Shared by `inviteUser` (an admin naming one address) and `redeemJoinLink`
 * (a holder naming their own, ADR-0021 §4). That sharing is the decision, not
 * a convenience: §4 promises a redemption calls the *same* `seedInvite` and
 * sends the *same* activation email as an admin invite, so the two must not be
 * two implementations that happen to agree today.
 *
 * The email is best-effort by design — a seeded membership that could not be
 * emailed about is still a seeded membership, and the invitee can recover it
 * through `/api/auth/resend-setup-link`. Callers surface `emailSent` so the
 * admin (or the joiner) knows whether to expect it.
 */
export interface SeedMemberParams {
  readonly email: string;
  readonly displayName?: string;
  readonly namespaceHandle: string;
  readonly membership: 'admin' | 'member';
  /** Shown to the invitee as who invited them; defaults to the workspace name. */
  readonly inviterName?: string;
  /**
   * `true` for `inviteUser` (an authenticated admin naming this person),
   * `false` for `redeemJoinLink` (an anonymous holder typing an address into a
   * public form). Passed straight through to `seedInvite`, which uses it to
   * decide whether this seed may modify an account that already exists at all.
   */
  readonly vouchedByAdmin: boolean;
}

export interface SeededMember {
  readonly uid: string;
  /** True when the `auth_users` row already existed (email collision). */
  readonly isExisting: boolean;
  readonly emailSent: boolean;
  readonly workspaceName: string;
}

export async function seedMemberAndNotify(
  params: SeedMemberParams,
  scope: CallerScope,
): Promise<SeededMember> {
  const invite = scope.system.inviteService;
  if (invite === null) {
    throw new PreconditionFailedError('Invite service is not configured');
  }

  const { uid, isExisting } = await invite.seedInvite({
    email: params.email,
    ...(params.displayName !== undefined ? { displayName: params.displayName } : {}),
    workspaceHandle: params.namespaceHandle,
    membership: params.membership,
    roles: [],
    vouchedByAdmin: params.vouchedByAdmin,
  });

  // Two independent decisions, and conflating them is what strands an invitee.
  //
  // WHICH EMAIL is decided by `pending` alone: an invitee who never activated
  // has no way in, so they always get the one-time sign-in link. An
  // already-active user re-added to the workspace gets the plain
  // workspace notification — they already have a session/password.
  //
  // WHETHER A PASSWORD IS PART OF IT is decided by the deployment flag. On a
  // Google/OIDC-only or magic-link-only deployment, forcing a password (and the
  // activation-link → /change-password path) strands the invitee: they set a
  // password they cannot use. There the same link simply signs them in and
  // lands them on workspace selection. Same split as `resendInvite` and
  // `/api/auth/resend-setup-link`, the other two paths that mail a pending
  // invitee.
  const pending = await invite.isInvitePending(uid);
  const passwordSetupEnabled = scope.system.passwordAuthEnabled === true;
  if (pending === true && passwordSetupEnabled) {
    await scope.userProfiles.setMustChangePassword(uid, true);
  }

  // Read outside the email branch — the caller returns this whether or not a
  // notification service is wired, and `/join`'s success page shows it, so
  // resolving it only when an email goes out would print the handle on a
  // deployment with email disabled while the preview beside it printed the
  // display name.
  //
  // Guarded on its own, because the membership is already committed by this
  // point: raising here would 500 AFTER adding the member and skip the audit
  // append, reporting failure for a write that succeeded. Everything past the
  // seed is best-effort; the handle is a truthful fallback.
  let workspaceName = params.namespaceHandle;
  try {
    const namespace = await scope.workspaces.getNamespace(params.namespaceHandle);
    workspaceName = namespace?.displayName ?? params.namespaceHandle;
  } catch (lookupErr) {
    console.error('[seed-member] Failed to read the workspace name:', lookupErr);
  }

  let emailSent = false;
  const notify = scope.system.inviteNotificationService;
  if (notify !== null) {
    try {
      const baseUrl = await resolveConfiguredBaseUrl(scope);
      const inviterName =
        typeof params.inviterName === 'string' && params.inviterName.trim() !== ''
          ? params.inviterName.trim()
          : workspaceName;
      const payload = {
        toEmail: params.email,
        inviterName,
        workspaceName,
        workspaceHandle: params.namespaceHandle,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      };
      if (pending === true) {
        await notify.sendActivationEmail({ ...payload, passwordSetupEnabled });
      } else {
        await notify.sendWorkspaceNotificationEmail(payload);
      }
      emailSent = true;
    } catch (emailErr) {
      console.error('[seed-member] Failed to send email:', emailErr);
      emailSent = false;
    }
  }

  return { uid, isExisting, emailSent, workspaceName };
}
