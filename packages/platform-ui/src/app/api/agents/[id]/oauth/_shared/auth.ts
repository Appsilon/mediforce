import { NextResponse } from 'next/server';
import { getAdminAuth } from '@mediforce/platform-infra';

/** Extract Firebase uid from the Authorization header. Returns either the uid
 *  string (on success) or a NextResponse the caller should return (401). */
export async function requireFirebaseUid(request: Request): Promise<string | NextResponse> {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token === '') {
    return NextResponse.json({ error: 'Unauthorized — missing Bearer token' }, { status: 401 });
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
  }
}

/** Resolve the namespace handle from the `?namespace=<handle>` query param.
 *  Returns the handle on success, or a NextResponse on missing/unknown. */
export async function requireNamespaceFromQuery(
  request: Request,
): Promise<string | NextResponse> {
  const handle = new URL(request.url).searchParams.get('namespace');
  if (handle === null || handle.length === 0) {
    return NextResponse.json(
      { error: 'Missing required query parameter: namespace' },
      { status: 400 },
    );
  }
  return handle;
}
