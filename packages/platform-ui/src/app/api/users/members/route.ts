import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@mediforce/platform-infra';

interface MemberDoc {
  uid: string;
  role: string;
  displayName?: string;
  avatarUrl?: string;
  joinedAt: string;
}

interface MemberResponse extends MemberDoc {
  email: string | null;
  lastSignInTime: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminAuth = getAdminAuth();

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

  const handle = req.nextUrl.searchParams.get('handle');
  if (handle === null || handle.trim() === '') {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  }

  try {
    const adminDb = getAdminFirestore();

    const membersSnap = await adminDb
      .collection('namespaces')
      .doc(handle)
      .collection('members')
      .get();

    const memberDocs: MemberDoc[] = membersSnap.docs.map((docSnap) => {
      const data = docSnap.data();
      const memberDoc: MemberDoc = {
        uid: typeof data.uid === 'string' ? data.uid : docSnap.id,
        role: typeof data.role === 'string' ? data.role : 'member',
        joinedAt: typeof data.joinedAt === 'string' ? data.joinedAt : new Date().toISOString(),
      };
      if (typeof data.displayName === 'string') {
        memberDoc.displayName = data.displayName;
      }
      if (typeof data.avatarUrl === 'string') {
        memberDoc.avatarUrl = data.avatarUrl;
      }
      return memberDoc;
    });

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
      ...memberDoc,
      email: authDataMap.get(memberDoc.uid)?.email ?? null,
      lastSignInTime: authDataMap.get(memberDoc.uid)?.lastSignInTime ?? null,
    }));

    return NextResponse.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
