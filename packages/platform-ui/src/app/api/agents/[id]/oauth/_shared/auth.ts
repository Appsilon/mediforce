import { NextResponse } from 'next/server';
import { getAdminAuth, type FirestoreNamespaceRepository } from '@mediforce/platform-infra';

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
 *  Returns the handle on success, or a NextResponse on missing/unknown.
 *
 *  WARNING: does NOT verify the caller belongs to the namespace. Routes that
 *  read or mutate namespace-scoped state must follow up with
 *  `requireNamespaceMembership`. Plain query-param trust is finding #3 from
 *  the PR #263 review. */
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

/** Assert the given uid is a member of the namespace. Returns undefined on
 *  success, a NextResponse on failure.
 *
 *  Responds with 404 (not 403) when the caller is not a member — avoids
 *  leaking whether the namespace exists to non-members and keeps the
 *  error shape uniform with "agent not found" responses. */
export async function requireNamespaceMembership(deps: {
  namespaceRepo: FirestoreNamespaceRepository;
  namespace: string;
  uid: string;
}): Promise<undefined | NextResponse> {
  const member = await deps.namespaceRepo.getMember(deps.namespace, deps.uid);
  if (member === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return undefined;
}
