/**
 * Email body helpers moved to `@mediforce/platform-api/services/invite-emails`
 * for Phase 2.6 — they're consumed by the framework-free Mailgun-backed
 * `InviteNotificationService` adapter inside `platform-api`. Re-exported here
 * so the still-inline routes (`/api/users/invite`, `/api/users/resend-invite`)
 * keep their imports stable until Wave 5/6 migrates them to handlers.
 */
export {
  sendInviteEmail,
  sendWorkspaceNotificationEmail,
  type SendInviteEmailParams,
  type SendWorkspaceNotificationEmailParams,
} from '@mediforce/platform-api/services';
