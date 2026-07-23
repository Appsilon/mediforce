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
