import { NextResponse } from 'next/server';
import { getAdminAuth } from '@mediforce/platform-infra';
import type { FirestoreNamespaceRepository } from '@mediforce/platform-infra';

/**
 * Resolve the set of namespace handles the caller may access.
 * - API key callers (X-Api-Key) → null (unrestricted, server-to-server trust)
 * - Firebase token callers → Set of namespace handles from membership
 * - No auth → NextResponse 401 (should not happen — middleware catches, defense-in-depth)
 */
export async function getCallerNamespaces(
  request: Request,
  namespaceRepo: FirestoreNamespaceRepository,
): Promise<Set<string> | null | NextResponse> {
  const apiKey = request.headers.get('X-Api-Key');
  const expectedKey = process.env.PLATFORM_API_KEY;
  if (apiKey && expectedKey && apiKey === expectedKey) {
    return null; // trusted, no filter
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token === '') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
  }

  const namespaces = await namespaceRepo.getNamespacesByUser(uid);
  return new Set(namespaces.map((ns) => ns.handle));
}
