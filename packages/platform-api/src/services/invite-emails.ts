/**
 * HTML + text body for the invite-flow email. Pure functions over
 * `SendEmailFn` — kept framework-free so the Mailgun-backed
 * `InviteNotificationService` adapter can delegate without forming a
 * `platform-api → platform-ui` dependency edge.
 */
import type { SendEmailFn } from '@mediforce/platform-core';
import { emailLayout, escapeHtml } from '@mediforce/platform-core';

export interface SendWorkspaceNotificationEmailParams {
  toEmail: string;
  inviterName: string;
  workspaceName: string;
  workspaceUrl: string;
  appUrl: string;
  senderName: string;
}

export async function sendWorkspaceNotificationEmail(
  params: SendWorkspaceNotificationEmailParams,
  sendEmail: SendEmailFn,
): Promise<void> {
  // Callers with no inviter to name pass the workspace name as `inviterName`;
  // spelling it out twice reads as "alpha has invited you to alpha".
  const namesInviter = params.inviterName !== params.workspaceName;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.3px">You've been invited</p>
    <p style="margin:0 0 28px;font-size:15px;color:#71717a;line-height:1.5">
      ${namesInviter ? `<strong style="color:#09090b">${escapeHtml(params.inviterName)}</strong> has invited you to the` : 'You have been invited to the'}
      <strong style="color:#09090b">${escapeHtml(params.workspaceName)}</strong> workspace on ${escapeHtml(params.senderName)}.
    </p>
    <a href="${escapeHtml(params.workspaceUrl)}" style="display:block;text-align:center;background:#1c8879;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Open workspace
    </a>`;

  const html = emailLayout(
    params.senderName,
    bodyHtml,
    `This invitation was sent to ${params.toEmail}. If you did not expect this email, you can safely ignore it.`,
  );

  const text = [
    `You've been invited to the ${params.workspaceName} workspace on ${params.senderName}.`,
    '',
    namesInviter
      ? `${params.inviterName} has invited you to collaborate.`
      : 'You have been invited to collaborate.',
    '',
    `Open workspace: ${params.workspaceUrl}`,
  ].join('\n');

  await sendEmail({
    to: [params.toEmail],
    subject: `You've been invited to ${params.workspaceName} on ${params.senderName}`,
    text,
    html,
  });
}

export interface SendInviteSetupEmailParams {
  toEmail: string;
  /** Absent for the self-service resend flow, which has no workspace context. */
  inviterName?: string;
  /** Absent for the self-service resend flow, which has no workspace context. */
  workspaceName?: string;
  activationUrl: string;
  appUrl: string;
  senderName: string;
  /**
   * `false` on a deployment with `ENABLE_PASSWORD_AUTH=false`, where the link
   * signs the invitee in and nothing more. Defaults to `true` — the password
   * deployment is the common one, and no caller has to opt in.
   */
  passwordSetupEnabled?: boolean;
}

/**
 * Account-setup email for a PENDING invitee. The button is a one-time 7-day
 * sign-in link.
 *
 * Copy varies on two axes. When `inviterName` + `workspaceName` are present
 * (admin-driven invite) it names them ("<inviter> invited you to
 * <workspace>"); the self-service "resend my setup link" recovery has no
 * workspace context and stays generic. When `passwordSetupEnabled` is `false`
 * every mention of setting a password is dropped — promising one on a
 * Google/OIDC-only or magic-link-only deployment sends the invitee looking for
 * a page that does not exist.
 */
export async function sendInviteSetupEmail(
  params: SendInviteSetupEmailParams,
  sendEmail: SendEmailFn,
): Promise<void> {
  const hasWorkspaceContext = params.workspaceName !== undefined;
  // `resendInvite` knows the workspace but not who is resending, so the
  // inviter clause is dropped rather than filled with the workspace name.
  const namesInviter =
    params.inviterName !== undefined && params.inviterName !== params.workspaceName;
  const passwordSetup = params.passwordSetupEnabled !== false;

  const heading = passwordSetup
    ? (hasWorkspaceContext ? 'Set up your account' : 'Finish setting up your account')
    : 'Sign in to your account';
  const callToAction = passwordSetup ? 'Set up your account' : 'Sign in';
  const actionSentence = passwordSetup
    ? 'Click below to sign in and set your password.'
    : 'Click below to sign in.';

  const workspaceStrong = `<strong style="color:#09090b">${escapeHtml(params.workspaceName ?? '')}</strong>`;
  const invitationHtml = namesInviter
    ? `<strong style="color:#09090b">${escapeHtml(params.inviterName ?? '')}</strong> invited you to ${workspaceStrong}.`
    : `You have been invited to ${workspaceStrong}.`;
  // Without workspace context (self-service resend) the account itself is the
  // subject, so the action sentence names the deployment instead.
  const accountActionHtml = passwordSetup
    ? `Click below to sign in and set your password for your ${escapeHtml(params.senderName)} account.`
    : `Click below to sign in to your ${escapeHtml(params.senderName)} account.`;
  const introHtml = hasWorkspaceContext
    ? `${invitationHtml} ${actionSentence}`
    : accountActionHtml;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.3px">${escapeHtml(heading)}</p>
    <p style="margin:0 0 28px;font-size:15px;color:#71717a;line-height:1.5">
      ${introHtml}
    </p>
    <a href="${escapeHtml(params.activationUrl)}" style="display:block;text-align:center;background:#1c8879;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      ${escapeHtml(callToAction)}
    </a>`;

  const html = emailLayout(
    params.senderName,
    bodyHtml,
    `This sign-in link was sent to ${params.toEmail} and expires in 7 days. If it has expired, request a new one at ${params.appUrl}/login. If you did not expect this email, you can safely ignore it.`,
  );

  const invitationText = namesInviter
    ? `${params.inviterName} invited you to ${params.workspaceName} on ${params.senderName}.`
    : `You have been invited to ${params.workspaceName} on ${params.senderName}.`;
  const accountActionText = passwordSetup
    ? `Finish setting up your ${params.senderName} account.`
    : `Sign in to your ${params.senderName} account.`;
  const introText = hasWorkspaceContext ? invitationText : accountActionText;

  const text = [
    introText,
    '',
    passwordSetup ? 'Click below to sign in and set your password:' : 'Click below to sign in:',
    params.activationUrl,
    '',
    'This link expires in 7 days.',
    `If it has expired, request a new one at ${params.appUrl}/login`,
  ].join('\n');

  await sendEmail({
    to: [params.toEmail],
    subject: passwordSetup
      ? `Set up your account on ${params.senderName}`
      : `Sign in to ${params.senderName}`,
    text,
    html,
  });
}
