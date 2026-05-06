import { NextResponse } from 'next/server';
import { getAdminAuth } from '@mediforce/platform-infra';
import type { FirestoreNamespaceRepository } from '@mediforce/platform-infra';

export type CallerIdentity =
  | { kind: 'apiKey' }
  | { kind: 'user'; uid: string; namespaces: Set<string> };

/**
 * Resolve caller identity from request headers.
 * API-key callers get unrestricted access. Firebase-token callers get their
 * namespace membership set. Returns NextResponse 401 on auth failure.
 */
export async function resolveCallerIdentity(
  request: Request,
  namespaceRepo: FirestoreNamespaceRepository,
): Promise<CallerIdentity | NextResponse> {
  const apiKey = request.headers.get('X-Api-Key');
  const expectedKey = process.env.PLATFORM_API_KEY;
  if (apiKey && expectedKey && apiKey === expectedKey) {
    return { kind: 'apiKey' };
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
  return { kind: 'user', uid, namespaces: new Set(namespaces.map((ns) => ns.handle)) };
}

export function callerCanAccess(caller: CallerIdentity, namespace: string): boolean {
  return caller.kind === 'apiKey' || caller.namespaces.has(namespace);
}

export function requireNamespaceAccess(
  caller: CallerIdentity,
  namespace: string | undefined,
): NextResponse | null {
  if (!namespace) {
    return NextResponse.json({ error: 'Resource has no namespace' }, { status: 403 });
  }
  if (callerCanAccess(caller, namespace)) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export function filterByNamespace<T extends { namespace?: string }>(
  caller: CallerIdentity,
  items: T[],
): T[] {
  if (caller.kind === 'apiKey') return items;
  return items.filter((item) => typeof item.namespace === 'string' && caller.namespaces.has(item.namespace));
}

/**
 * Backward-compatible shim. Existing callers that use the old
 * `getCallerNamespaces` return type (Set | null | NextResponse) keep working.
 * New code should use `resolveCallerIdentity` directly.
 */
export async function getCallerNamespaces(
  request: Request,
  namespaceRepo: FirestoreNamespaceRepository,
): Promise<Set<string> | null | NextResponse> {
  const identity = await resolveCallerIdentity(request, namespaceRepo);
  if (identity instanceof NextResponse) return identity;
  if (identity.kind === 'apiKey') return null;
  return identity.namespaces;
}
