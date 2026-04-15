import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/platform-services';
import { getAdminAuth, getAdminFirestore, FirebaseInviteService } from '@mediforce/platform-infra';

interface MemberDoc {
  uid: string;
  role: string;
  displayName?: string;
  avatarUrl?: string;
  joinedAt: string;
}

interface MemberResponse extends MemberDoc {
  lastSignInTime: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const handle = req.nextUrl.searchParams.get('handle');
  if (handle === null || handle.trim() === '') {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  }

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();
    const inviteService = new FirebaseInviteService(adminAuth, adminDb);

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
    const lastSignInMap = await inviteService.getUsersLastSignIn(uids);

    const members: MemberResponse[] = memberDocs.map((memberDoc) => ({
      ...memberDoc,
      lastSignInTime: lastSignInMap.get(memberDoc.uid) ?? null,
    }));

    return NextResponse.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
