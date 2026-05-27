import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

interface MemberResponse {
  uid: string;
  role: string;
  displayName?: string;
  avatarUrl?: string;
  joinedAt: string;
  email: string | null;
  lastSignInTime: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminAuth = getAdminAuth();

  const apiKey = req.headers.get('X-Api-Key');
  const expectedKey = process.env.PLATFORM_API_KEY;
  const apiKeyOk = Boolean(apiKey) && Boolean(expectedKey) && apiKey === expectedKey;

  if (!apiKeyOk) {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token === '') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const handle = req.nextUrl.searchParams.get('handle');
  if (handle === null || handle.trim() === '') {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  }

  try {
    const { namespaceRepo } = getPlatformServices();
    const memberDocs = await namespaceRepo.getMembers(handle);

    const uids = memberDocs.map((m) => m.uid);
    const userRecords = await Promise.all(
      uids.map((uid) => adminAuth.getUser(uid).catch(() => null)),
    );
    const authDataMap = new Map<string, { email: string | null; lastSignInTime: string | null }>();
    for (const record of userRecords) {
      if (record !== null) {
        authDataMap.set(record.uid, {
          email: record.email ?? null,
          lastSignInTime: record.metadata.lastSignInTime ?? null,
        });
      }
    }

    const members: MemberResponse[] = memberDocs.map((memberDoc) => ({
      uid: memberDoc.uid,
      role: memberDoc.role,
      ...(memberDoc.displayName !== undefined ? { displayName: memberDoc.displayName } : {}),
      ...(memberDoc.avatarUrl !== undefined ? { avatarUrl: memberDoc.avatarUrl } : {}),
      joinedAt: memberDoc.joinedAt,
      email: authDataMap.get(memberDoc.uid)?.email ?? null,
      lastSignInTime: authDataMap.get(memberDoc.uid)?.lastSignInTime ?? null,
    }));

    return NextResponse.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
