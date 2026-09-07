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
  });

  // A pending invitee (never activated) is gated into the create-password flow
  // only when password auth is the intended first-credential method. On a
  // Google/OIDC-only or magic-link-only deployment, forcing a password (and the
  // activation-link → /change-password path) strands the invitee: they set a
  // password they cannot use and could simply have signed in with their
  // provider. An already-active user re-added to the workspace always keeps the
  // plain workspace-notification path — they already have a session/password.
  const pending = await invite.isInvitePending(uid);
  const forcePasswordSetup = pending === true && scope.system.passwordAuthEnabled === true;
  if (forcePasswordSetup) {
    await scope.userProfiles.setMustChangePassword(uid, true);
  }

  const namespace = await scope.workspaces.getNamespace(params.namespaceHandle);
  const workspaceName = namespace?.displayName ?? params.namespaceHandle;

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
      if (forcePasswordSetup) {
        await notify.sendActivationEmail(payload);
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
