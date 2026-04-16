import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/platform-services';
import { getAdminAuth, getAdminFirestore, FirebaseInviteService } from '@mediforce/platform-infra';
import { sendInviteEmail } from '@/lib/send-invite-email';

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
    typeof (body as Record<string, unknown>).uid !== 'string'
  ) {
    return NextResponse.json({ error: 'uid is required' }, { status: 400 });
  }

  const { uid } = body as { uid: string };

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();
    const inviteService = new FirebaseInviteService(adminAuth, adminDb);

    // Reset password and get user email in parallel
    const [temporaryPassword, userRecord] = await Promise.all([
      inviteService.resetInvitePassword(uid),
      adminAuth.getUser(uid),
    ]);

    const email = userRecord.email;
    if (email === undefined || email === '') {
      return NextResponse.json({ error: 'User has no email address' }, { status: 400 });
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
          toEmail: email,
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

    return NextResponse.json({ uid, email, temporaryPassword, emailSent });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
