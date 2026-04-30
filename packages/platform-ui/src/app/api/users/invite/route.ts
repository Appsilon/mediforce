import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminFirestore, FirebaseInviteService, createMailgunSender } from '@mediforce/platform-infra';
import { sendInviteEmail, sendWorkspaceNotificationEmail } from '@/lib/send-invite-email';

const InviteBodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).optional(),
  namespaceHandle: z.string().min(1).regex(/^[a-z0-9-]+$/, 'namespaceHandle must be lowercase alphanumeric with hyphens only'),
  role: z.enum(['member', 'admin']).optional().default('member'),
  inviterName: z.string().min(1).optional(),
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

  const parsed = InviteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const { email, displayName, namespaceHandle, role, inviterName } = parsed.data;

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
    const { uid, temporaryPassword, isExisting } = await inviteService.createInvitedUser(
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
            role,
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

    const mailgunConfigured =
      typeof mailgunApiKey === 'string' && mailgunApiKey !== '' &&
      typeof mailgunDomain === 'string' && mailgunDomain !== '' &&
      typeof fromEmail === 'string' && fromEmail !== '';

    if (mailgunConfigured) {
      const sendEmail = createMailgunSender({
        apiKey: mailgunApiKey as string,
        domain: mailgunDomain as string,
        defaultFrom: fromEmail as string,
        defaultSenderName: senderName,
      });

      try {
        if (isExisting && typeof namespaceHandle === 'string' && namespaceHandle.trim() !== '') {
          const namespaceDoc = await adminDb.collection('namespaces').doc(namespaceHandle).get();
          const workspaceName = namespaceDoc.exists
            ? (namespaceDoc.data()?.displayName as string | undefined ?? namespaceHandle)
            : namespaceHandle;

          await sendWorkspaceNotificationEmail({
            toEmail: email.trim().toLowerCase(),
            inviterName: typeof inviterName === 'string' && inviterName.trim() !== ''
              ? inviterName.trim()
              : senderName,
            workspaceName,
            workspaceUrl: `${appUrl}/${namespaceHandle}`,
            appUrl,
            senderName,
          }, sendEmail);
        } else {
          await sendInviteEmail({
            toEmail: email.trim().toLowerCase(),
            temporaryPassword,
            appUrl,
            senderName,
          }, sendEmail);
        }
        emailSent = true;
      } catch (emailErr) {
        console.error('[invite] Failed to send email:', emailErr);
        emailSent = false;
      }
    }

    return NextResponse.json(
      { uid, email: email.trim().toLowerCase(), temporaryPassword, emailSent, isExisting },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
