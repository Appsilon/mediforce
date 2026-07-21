/**
 * Framework-free interfaces for the invite + workspace-notification flows.
 * Adapters in `platform-services.ts` wire the Postgres seed-based invite
 * (ADR-0002 §3.1) + Mailgun through `CallerScope.system`. Named
 * `InviteNotificationService` (not `NotificationService`) to avoid collision
 * with `platform-core`'s workflow-engine task notifications.
 */

export interface InvitedUser {
  readonly uid: string;
  /** True when the `auth_users` row already existed (email collision). */
  readonly isExisting: boolean;
}

export interface SeedInviteInput {
  readonly email: string;
  readonly displayName?: string;
  readonly workspaceHandle: string;
  readonly membership: 'owner' | 'admin' | 'member';
  readonly roles?: readonly string[];
}

export interface InviteService {
  /**
   * Pre-seed the invitee's `auth_users` row + workspace membership + global
   * roles (ADR-0002 §3.1). No temporary password and no credentials email —
   * the invitee signs in later via Google (verified-email auto-link) or by
   * setting a password. Idempotent on email collision — returns the existing
   * uid with `isExisting: true` and leaves the existing membership untouched.
   */
  seedInvite(input: SeedInviteInput): Promise<InvitedUser>;

  getUserEmail(uid: string): Promise<string | null>;

  /**
   * True iff the invitee still needs to establish a session: no
   * `auth_sessions` row exists for the uid AND no password has been set
   * (`auth_users.password_hash` is null). Resend-invite refuses to re-notify
   * an already-active user.
   */
  isInvitePending(uid: string): Promise<boolean>;
}

export interface SendWorkspaceNotificationEmailInput {
  readonly toEmail: string;
  readonly inviterName: string;
  readonly workspaceName: string;
  readonly workspaceHandle: string;
  /**
   * Overrides the adapter's construction-time app URL when the deployment has
   * configured a `platform.baseUrl` setting. Absent → the adapter falls back to
   * `NEXT_PUBLIC_PLATFORM_URL` → localhost.
   */
  readonly baseUrl?: string;
}

/**
 * `null` in `SystemServices` when Mailgun/SMTP env vars are unset — handlers
 * detect that and skip email delivery while still seeding the invite. There is
 * no temporary-password email in the seed-based model (ADR-0002 §3.1); the
 * only invite email is the workspace-notification.
 */
export interface InviteNotificationService {
  sendWorkspaceNotificationEmail(input: SendWorkspaceNotificationEmailInput): Promise<void>;
}
