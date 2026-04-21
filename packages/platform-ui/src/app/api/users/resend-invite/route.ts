import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminAuth, getAdminFirestore, FirebaseInviteService } from '@mediforce/platform-infra';
import { sendInviteEmail } from '@/lib/send-invite-email';

const ResendInviteBodySchema = z.object({
  uid: z.string().min(1),
  namespaceHandle: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const adminAuth = getAdminAuth();

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token === '') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let callerUid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ResendInviteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const { uid, namespaceHandle } = parsed.data;

  try {
    const adminDb = getAdminFirestore();

    const memberSnap = await adminDb
      .collection('namespaces')
      .doc(namespaceHandle)
      .collection('members')
      .doc(callerUid)
      .get();
    const memberRole = memberSnap.exists ? (memberSnap.data()?.role as string | undefined) : undefined;
    if (memberRole !== 'owner' && memberRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const inviteService = new FirebaseInviteService(adminAuth, adminDb);

    // Validate user has email before resetting password
    const userRecord = await adminAuth.getUser(uid);
    const email = userRecord.email;
    if (email === undefined || email === '') {
      return NextResponse.json({ error: 'User has no email address' }, { status: 400 });
    }

    const temporaryPassword = await inviteService.resetInvitePassword(uid);

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
