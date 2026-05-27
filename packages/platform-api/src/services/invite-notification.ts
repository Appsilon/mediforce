/**
 * Framework-free interfaces for the invite + workspace-notification flows.
 *
 * Phase 2.6 introduces these so the upcoming `/api/users/invite` and
 * `/api/users/resend-invite` headless handlers (Wave 5/6) can declare their
 * dependencies without dragging Firebase or Mailgun into `platform-api`.
 * Adapters live in `platform-services.ts` and are wired through
 * `CallerScope.system`.
 *
 * Naming note: there is already a `NotificationService` in `platform-core`
 * for workflow-engine task notifications (`send(event, targets)`). To avoid
 * the collision and keep semantics precise, the invite/workspace email
 * surface is intentionally named `InviteNotificationService` here — it sends
 * exactly two well-known emails (invite credentials, workspace-add notice).
 */

export interface InvitedUser {
  /** Firebase Auth uid. */
  readonly uid: string;
  /**
   * Plaintext temporary password issued by `createInvitedUser`. Empty string
   * when `isExisting` is true — pre-existing Firebase Auth users keep their
   * password and the caller switches to the workspace-notification email
   * instead of the invite email.
   */
  readonly temporaryPassword: string;
  /** True iff the Firebase Auth user already existed. */
  readonly isExisting: boolean;
}

export interface InviteService {
  /**
   * Create a Firebase Auth user and Firestore `users/{uid}` doc with
   * `mustChangePassword: true`. Idempotent on email collision — returns the
   * existing uid with empty `temporaryPassword`.
   */
  createInvitedUser(
    email: string,
    displayName: string | undefined,
  ): Promise<InvitedUser>;

  /**
   * Rotate the user's password and re-flag `mustChangePassword`. Returns the
   * new plaintext password — caller is responsible for delivering it via
   * `InviteNotificationService.sendInviteEmail`.
   */
  resetInvitePassword(uid: string): Promise<string>;

  /** Email on the user record, or `null` if the user has none. */
  getUserEmail(uid: string): Promise<string | null>;

  /**
   * True iff the invite is still pending — i.e. the user has either never
   * signed in (`lastSignInTime` is null/empty) or still carries the
   * `mustChangePassword` flag in Firestore. Used by resend-invite to refuse
   * resetting an active user's password.
   */
  isInvitePending(uid: string): Promise<boolean>;
}

export interface SendInviteEmailInput {
  readonly toEmail: string;
  readonly temporaryPassword: string;
  readonly appUrl: string;
  readonly senderName: string;
}

export interface SendWorkspaceNotificationEmailInput {
  readonly toEmail: string;
  readonly inviterName: string;
  readonly workspaceName: string;
  readonly workspaceUrl: string;
  readonly appUrl: string;
  readonly senderName: string;
}

/**
 * Sends the two well-known invite-flow emails. Wave 5/6 handlers consume
 * this through `scope.system.inviteNotificationService` and decide between
 * the two payloads based on whether the invited user already existed.
 *
 * `null` in `SystemServices` when Mailgun env vars are unset — handlers
 * detect that and skip email delivery while still returning the temporary
 * password in the response (matching today's behavior).
 */
export interface InviteNotificationService {
  sendInviteEmail(input: SendInviteEmailInput): Promise<void>;
  sendWorkspaceNotificationEmail(input: SendWorkspaceNotificationEmailInput): Promise<void>;
}
