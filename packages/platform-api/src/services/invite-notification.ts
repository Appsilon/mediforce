/**
 * Framework-free interfaces for the invite + workspace-notification flows.
 * Adapters in `platform-services.ts` wire Firebase + Mailgun through
 * `CallerScope.system`. Named `InviteNotificationService` (not
 * `NotificationService`) to avoid collision with `platform-core`'s
 * workflow-engine task notifications.
 */

export interface InvitedUser {
  readonly uid: string;
  /** Empty string when `isExisting` — pre-existing users keep their password. */
  readonly temporaryPassword: string;
  readonly isExisting: boolean;
}

export interface InviteService {
  /** Idempotent on email collision — returns existing uid with empty password. */
  createInvitedUser(email: string, displayName: string | undefined): Promise<InvitedUser>;

  /** Rotates password + re-flags `mustChangePassword`. Returns new plaintext. */
  resetInvitePassword(uid: string): Promise<string>;

  getUserEmail(uid: string): Promise<string | null>;

  /**
   * True iff user never signed in (`lastSignInTime` empty) or still carries
   * `mustChangePassword`. Resend-invite refuses to reset an active user.
   */
  isInvitePending(uid: string): Promise<boolean>;
}

export interface SendInviteEmailInput {
  readonly toEmail: string;
  readonly temporaryPassword: string;
}

export interface SendWorkspaceNotificationEmailInput {
  readonly toEmail: string;
  readonly inviterName: string;
  readonly workspaceName: string;
  readonly workspaceHandle: string;
}

/**
 * `null` in `SystemServices` when Mailgun env vars are unset — handlers
 * detect that and skip email delivery while still returning the temporary
 * password in the response.
 */
export interface InviteNotificationService {
  sendInviteEmail(input: SendInviteEmailInput): Promise<void>;
  sendWorkspaceNotificationEmail(input: SendWorkspaceNotificationEmailInput): Promise<void>;
}
