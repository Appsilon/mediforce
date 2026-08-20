/**
 * Framework-free interfaces for the invite + workspace-notification flows.
 * Adapters in `platform-services.ts` wire the Postgres seed-based invite
 * (PLAN-0002 §3.1) + Mailgun through `CallerScope.system`. Named
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
   * roles (PLAN-0002 §3.1). No temporary password and no credentials email —
   * the invitee signs in later via Google (verified-email auto-link) or by
   * setting a password. Idempotent on email collision — returns the existing
   * uid with `isExisting: true`; a re-invite with a different `membership`
   * updates the existing workspace membership.
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
   * `APP_BASE_URL`/`NEXT_PUBLIC_APP_URL` → localhost.
   */
  readonly baseUrl?: string;
}

/**
 * Sent to a PENDING invitee (never activated). Carries a one-time 7-day
 * sign-in link that logs the invitee in and lands them on the create-password
 * page. Active users who are re-added instead get
 * `sendWorkspaceNotificationEmail` — they already have a session/password.
 *
 * The workspace/inviter fields are OPTIONAL: the admin-driven invite flow
 * supplies them ("<inviter> invited you to <workspace>"), while the
 * self-service "resend my setup link" recovery (`/api/auth/resend-setup-link`)
 * has no workspace context and sends the generic account-setup copy.
 */
export interface SendActivationEmailInput {
  readonly toEmail: string;
  readonly inviterName?: string;
  readonly workspaceName?: string;
  readonly workspaceHandle?: string;
  /**
   * Overrides the adapter's construction-time app URL when the deployment has
   * configured a `platform.baseUrl` setting — same semantics as
   * `SendWorkspaceNotificationEmailInput`. Absent → the adapter falls back to
   * `APP_BASE_URL`/`NEXT_PUBLIC_APP_URL` → localhost.
   */
  readonly baseUrl?: string;
  /**
   * `false` where `ENABLE_PASSWORD_AUTH=false`: the link lands the invitee on
   * workspace selection rather than the create-password page, and the copy
   * stops promising a password they cannot set. Defaults to `true`.
   */
  readonly passwordSetupEnabled?: boolean;
}

/**
 * `null` in `SystemServices` when Mailgun/SMTP env vars are unset — handlers
 * detect that and skip email delivery while still seeding the invite. A pending
 * invitee gets `sendActivationEmail` (one-time 7-day sign-in link → create
 * password); an already-active user re-added to a workspace gets
 * `sendWorkspaceNotificationEmail`.
 */
export interface InviteNotificationService {
  sendWorkspaceNotificationEmail(input: SendWorkspaceNotificationEmailInput): Promise<void>;
  sendActivationEmail(input: SendActivationEmailInput): Promise<void>;
}
