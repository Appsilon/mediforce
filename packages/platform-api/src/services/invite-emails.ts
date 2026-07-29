/**
 * HTML + text body for the invite-flow email. Pure functions over
 * `SendEmailFn` — kept framework-free so the Mailgun-backed
 * `InviteNotificationService` adapter can delegate without forming a
 * `platform-api → platform-ui` dependency edge.
 */
import type { SendEmailFn } from '@mediforce/platform-core';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailLayout(senderName: string, bodyHtml: string, footerText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">

        <!-- Header -->
        <tr><td style="background:#1c8879;border-radius:8px 8px 0 0;padding:28px 32px">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:-0.3px">${escapeHtml(senderName)}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px">
          ${bodyHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#ffffff;border-top:1px solid #f4f4f5;border-radius:0 0 8px 8px;padding:20px 32px">
          <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5">${escapeHtml(footerText)}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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
  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.3px">You've been invited</p>
    <p style="margin:0 0 28px;font-size:15px;color:#71717a;line-height:1.5">
      <strong style="color:#09090b">${escapeHtml(params.inviterName)}</strong> has invited you to the
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
    `${params.inviterName} has invited you to collaborate.`,
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
}

/**
 * Account-setup email for a PENDING invitee. Framed as "set up your account"
 * (not a notification): the button is a one-time 7-day sign-in link that logs
 * the invitee in and lands them on the create-password page.
 *
 * When `inviterName` + `workspaceName` are present (admin-driven invite) the
 * copy names them ("<inviter> invited you to <workspace>"). When absent
 * (self-service "resend my setup link" recovery) the copy is generic — the
 * flow has no workspace context.
 */
export async function sendInviteSetupEmail(
  params: SendInviteSetupEmailParams,
  sendEmail: SendEmailFn,
): Promise<void> {
  const hasWorkspaceContext =
    params.inviterName !== undefined && params.workspaceName !== undefined;

  const heading = hasWorkspaceContext ? 'Set up your account' : 'Finish setting up your account';

  const introHtml = hasWorkspaceContext
    ? `<strong style="color:#09090b">${escapeHtml(params.inviterName ?? '')}</strong> invited you to
      <strong style="color:#09090b">${escapeHtml(params.workspaceName ?? '')}</strong>. Click below to sign in and set your password.`
    : 'Click below to sign in and set your password for your Mediforce account.';

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.3px">${escapeHtml(heading)}</p>
    <p style="margin:0 0 28px;font-size:15px;color:#71717a;line-height:1.5">
      ${introHtml}
    </p>
    <a href="${escapeHtml(params.activationUrl)}" style="display:block;text-align:center;background:#1c8879;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Set up your account
    </a>`;

  const html = emailLayout(
    params.senderName,
    bodyHtml,
    `This account-setup link was sent to ${params.toEmail} and expires in 7 days. If it has expired, request a new one at ${params.appUrl}/login. If you did not expect this email, you can safely ignore it.`,
  );

  const introText = hasWorkspaceContext
    ? `${params.inviterName} invited you to ${params.workspaceName} on ${params.senderName}.`
    : `Finish setting up your ${params.senderName} account.`;

  const text = [
    introText,
    '',
    'Click below to sign in and set your password:',
    params.activationUrl,
    '',
    'This link expires in 7 days.',
    `If it has expired, request a new one at ${params.appUrl}/login`,
  ].join('\n');

  await sendEmail({
    to: [params.toEmail],
    subject: `Set up your account on ${params.senderName}`,
    text,
    html,
  });
}
