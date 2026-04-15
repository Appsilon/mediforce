import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/platform-services';
import { getAdminAuth, getAdminFirestore, FirebaseInviteService } from '@mediforce/platform-infra';

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

  const { email, displayName } = body as { email: string; displayName?: string };

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();
    const inviteService = new FirebaseInviteService(adminAuth, adminDb);
    const uid = await inviteService.createInvitedUser(
      email.trim().toLowerCase(),
      typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : undefined,
    );
    return NextResponse.json({ uid, email }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
