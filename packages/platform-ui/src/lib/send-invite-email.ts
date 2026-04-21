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

async function sendMailgunMessage(params: {
  toEmail: string;
  subject: string;
  text: string;
  html: string;
  fromEmail: string;
  senderName: string;
  mailgunApiKey: string;
  mailgunDomain: string;
}): Promise<void> {
  const from = `${params.senderName} <${params.fromEmail}>`;
  const formData = new URLSearchParams();
  formData.append('from', from);
  formData.append('to', params.toEmail);
  formData.append('subject', params.subject);
  formData.append('text', params.text);
  formData.append('html', params.html);

  const credentials = Buffer.from(`api:${params.mailgunApiKey}`).toString('base64');
  const response = await fetch(
    `https://api.mailgun.net/v3/${params.mailgunDomain}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mailgun error ${response.status}: ${body}`);
  }
}

export interface SendWorkspaceNotificationEmailParams {
  toEmail: string;
  inviterName: string;
  workspaceName: string;
  workspaceUrl: string;
  appUrl: string;
  fromEmail: string;
  senderName: string;
  mailgunApiKey: string;
  mailgunDomain: string;
}

export async function sendWorkspaceNotificationEmail(params: SendWorkspaceNotificationEmailParams): Promise<void> {
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

  await sendMailgunMessage({
    toEmail: params.toEmail,
    subject: `You've been invited to ${params.workspaceName} on ${params.senderName}`,
    text,
    html,
    fromEmail: params.fromEmail,
    senderName: params.senderName,
    mailgunApiKey: params.mailgunApiKey,
    mailgunDomain: params.mailgunDomain,
  });
}

export interface SendInviteEmailParams {
  toEmail: string;
  temporaryPassword: string;
  appUrl: string;
  fromEmail: string;
  senderName: string;
  mailgunApiKey: string;
  mailgunDomain: string;
}

export async function sendInviteEmail(params: SendInviteEmailParams): Promise<void> {
  const loginUrl = `${params.appUrl}/login`;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.3px">You've been invited</p>
    <p style="margin:0 0 28px;font-size:15px;color:#71717a;line-height:1.5">
      Your account has been created. Use the credentials below to sign in for the first time. You will be asked to set a new password immediately.
    </p>
    <!-- Credentials box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;border-radius:6px;margin-bottom:28px">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e4e4e7">
          <p style="margin:0 0 2px;font-size:11px;font-weight:500;color:#71717a;text-transform:uppercase;letter-spacing:0.5px">Login</p>
          <p style="margin:0;font-size:15px;font-weight:500;color:#09090b">${escapeHtml(params.toEmail)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px">
          <p style="margin:0 0 2px;font-size:11px;font-weight:500;color:#71717a;text-transform:uppercase;letter-spacing:0.5px">Temporary password</p>
          <p style="margin:0;font-size:15px;font-weight:500;color:#09090b;font-family:monospace">${escapeHtml(params.temporaryPassword)}</p>
        </td>
      </tr>
    </table>
    <a href="${escapeHtml(loginUrl)}" style="display:block;text-align:center;background:#1c8879;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Sign in to ${escapeHtml(params.senderName)}
    </a>`;

  const html = emailLayout(
    params.senderName,
    bodyHtml,
    `This invitation was sent to ${params.toEmail}. If you did not expect this email, you can safely ignore it.`,
  );

  const text = [
    `You've been invited to ${params.senderName}.`,
    '',
    'Your account has been created. Sign in with the credentials below.',
    'You will be asked to set a new password immediately after signing in.',
    '',
    `Login: ${params.toEmail}`,
    `Temporary password: ${params.temporaryPassword}`,
    '',
    `Sign in at: ${loginUrl}`,
  ].join('\n');

  await sendMailgunMessage({
    toEmail: params.toEmail,
    subject: `You've been invited to ${params.senderName}`,
    text,
    html,
    fromEmail: params.fromEmail,
    senderName: params.senderName,
    mailgunApiKey: params.mailgunApiKey,
    mailgunDomain: params.mailgunDomain,
  });
}
