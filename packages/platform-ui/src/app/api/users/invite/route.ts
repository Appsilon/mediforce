import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { validateApiKey } from '@/lib/platform-services';
import { getAdminAuth, getAdminFirestore, FirebaseInviteService } from '@mediforce/platform-infra';

async function sendInviteEmail(params: {
  toEmail: string;
  temporaryPassword: string;
  appUrl: string;
  fromEmail: string;
  senderName: string;
  mailgunApiKey: string;
  mailgunDomain: string;
}): Promise<void> {
  const from = `${params.senderName} <${params.fromEmail}>`;
  const loginUrl = `${params.appUrl}/login`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">

        <!-- Header -->
        <tr><td style="background:#09090b;border-radius:8px 8px 0 0;padding:28px 32px">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:-0.3px">${params.senderName}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px">
          <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.3px">You've been invited</p>
          <p style="margin:0 0 28px;font-size:15px;color:#71717a;line-height:1.5">
            Your account has been created. Use the credentials below to sign in for the first time. You will be asked to set a new password immediately.
          </p>

          <!-- Credentials box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;border-radius:6px;margin-bottom:28px">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #e4e4e7">
                <p style="margin:0 0 2px;font-size:11px;font-weight:500;color:#71717a;text-transform:uppercase;letter-spacing:0.5px">Login</p>
                <p style="margin:0;font-size:15px;font-weight:500;color:#09090b">${params.toEmail}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px">
                <p style="margin:0 0 2px;font-size:11px;font-weight:500;color:#71717a;text-transform:uppercase;letter-spacing:0.5px">Temporary password</p>
                <p style="margin:0;font-size:15px;font-weight:500;color:#09090b;font-family:monospace">${params.temporaryPassword}</p>
              </td>
            </tr>
          </table>

          <a href="${loginUrl}" style="display:block;text-align:center;background:#09090b;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
            Sign in to ${params.senderName}
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#ffffff;border-top:1px solid #f4f4f5;border-radius:0 0 8px 8px;padding:20px 32px">
          <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5">
            This invitation was sent to ${params.toEmail}. If you did not expect this email, you can safely ignore it.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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

  const formData = new URLSearchParams();
  formData.append('from', from);
  formData.append('to', params.toEmail);
  formData.append('subject', `You've been invited to ${params.senderName}`);
  formData.append('text', text);
  formData.append('html', html);

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
    const text = await response.text();
    throw new Error(`Mailgun error ${response.status}: ${text}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).email !== 'string'
  ) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  const { email, displayName, namespaceHandle, role } = body as {
    email: string;
    displayName?: string;
    namespaceHandle?: string;
    role?: string;
  };

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();
    const inviteService = new FirebaseInviteService(adminAuth, adminDb);
    const { uid, temporaryPassword } = await inviteService.createInvitedUser(
      email.trim().toLowerCase(),
      typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : undefined,
      undefined,
    );

    if (typeof namespaceHandle === 'string' && namespaceHandle.trim() !== '') {
      await adminDb
        .collection('namespaces')
        .doc(namespaceHandle)
        .collection('members')
        .doc(uid)
        .set(
          {
            uid,
            role: role ?? 'member',
            ...(typeof displayName === 'string' && displayName.trim() !== ''
              ? { displayName: displayName.trim() }
              : {}),
            joinedAt: new Date().toISOString(),
          },
          { merge: true },
        );

      await adminDb.collection('users').doc(uid).set(
        { organizations: FieldValue.arrayUnion(namespaceHandle) },
        { merge: true },
      );
    }

    let emailSent = false;
    const mailgunApiKey = process.env.MAILGUN_API_KEY;
    const mailgunDomain = process.env.MAILGUN_DOMAIN;
    const fromEmail = process.env.MAILGUN_FROM_EMAIL;
    const senderName = process.env.MAILGUN_SENDER_NAME ?? 'Mediforce';
    const appUrl = process.env.NEXT_PUBLIC_PLATFORM_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;

    if (
      typeof mailgunApiKey === 'string' && mailgunApiKey !== '' &&
      typeof mailgunDomain === 'string' && mailgunDomain !== '' &&
      typeof fromEmail === 'string' && fromEmail !== ''
    ) {
      try {
        await sendInviteEmail({
          toEmail: email.trim().toLowerCase(),
          temporaryPassword,
          appUrl,
          fromEmail,
          senderName,
          mailgunApiKey,
          mailgunDomain,
        });
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }

    return NextResponse.json({ uid, email: email.trim().toLowerCase(), temporaryPassword, emailSent }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
