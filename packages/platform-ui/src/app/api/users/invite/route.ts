import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { validateApiKey } from '@/lib/platform-services';
import { getAdminAuth, getAdminFirestore, FirebaseInviteService } from '@mediforce/platform-infra';

async function sendInviteEmail(params: {
  toEmail: string;
  temporaryPassword: string;
  appUrl: string;
  fromEmail: string;
  mailgunApiKey: string;
  mailgunDomain: string;
}): Promise<void> {
  const formData = new URLSearchParams();
  formData.append('from', params.fromEmail);
  formData.append('to', params.toEmail);
  formData.append("subject", "You've been invited to Mediforce");
  formData.append('text', [
    "You've been invited to Mediforce.",
    '',
    `Login: ${params.toEmail}`,
    `Temporary password: ${params.temporaryPassword}`,
    '',
    `Sign in at: ${params.appUrl}/login`,
    '',
    'Please change your password after first sign-in using the "Forgot password?" link.',
  ].join('\n'));
  formData.append('html', `
    <p>You've been invited to <strong>Mediforce</strong>.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Login</td><td style="padding:4px 0"><strong>${params.toEmail}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Temporary password</td><td style="padding:4px 0"><strong>${params.temporaryPassword}</strong></td></tr>
    </table>
    <p><a href="${params.appUrl}/login" style="background:#000;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;display:inline-block">Sign in to Mediforce</a></p>
    <p style="color:#666;font-size:12px">Please change your password after first sign-in using the "Forgot password?" link on the login page.</p>
  `);

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
