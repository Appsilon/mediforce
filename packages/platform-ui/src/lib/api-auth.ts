import { NextResponse } from 'next/server';
import { getAdminAuth } from '@mediforce/platform-infra';
import type { FirestoreNamespaceRepository } from '@mediforce/platform-infra';
import type { CallerIdentity } from '@mediforce/platform-api/auth';

// Re-export the canonical type from platform-api so route handlers can import
// it from a single place. Pure-handler code in @mediforce/platform-api uses
// the same shape — the Next.js layer only adds the resolution-from-Request
// part below.
export type { CallerIdentity };
export { callerCanAccess, assertNamespaceAccess, filterByCaller } from '@mediforce/platform-api/auth';

/**
 * Resolve caller identity from request headers.
 * API-key callers get unrestricted access. Firebase-token callers get their
 * namespace membership set. Returns NextResponse 401 on auth failure.
 *
 * For routes built on `createRouteAdapter`, the adapter calls this internally —
 * you don't need to invoke it directly. Inline (non-adapted) routes still
 * call it as a first step.
 */
export async function resolveCallerIdentity(
  request: Request,
  namespaceRepo: FirestoreNamespaceRepository,
): Promise<CallerIdentity | NextResponse> {
  const apiKey = request.headers.get('X-Api-Key');
  const expectedKey = process.env.PLATFORM_API_KEY;
  if (apiKey && expectedKey && apiKey === expectedKey) {
    return { kind: 'apiKey', isSystemActor: true };
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
  return {
    kind: 'user',
    uid,
    namespaces: new Set(namespaces.map((ns) => ns.handle)),
    isSystemActor: false,
  };
}

/**
 * Inline-route convenience: returns a 403 `NextResponse` when the caller is
 * not allowed to access `namespace`, or `null` when access is permitted.
 *
 * NEW handlers should throw `ForbiddenError` from @mediforce/platform-api/auth
 * via `assertNamespaceAccess` instead — the route adapter handles the HTTP
 * mapping. This helper is kept for routes that still have inline handlers.
 */
export function requireNamespaceAccess(
  caller: CallerIdentity,
  namespace: string | undefined,
): NextResponse | null {
  if (caller.isSystemActor) return null;
  if (!namespace) {
    return NextResponse.json({ error: 'Resource has no namespace' }, { status: 403 });
  }
  if (caller.namespaces.has(namespace)) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * Inline-route convenience: filter a list of entities (with `namespace?: string`)
 * to those the caller may see.
 *
 * NEW handlers should call `filterByCaller` from @mediforce/platform-api/auth.
 */
export function filterByNamespace<T extends { namespace?: string }>(
  caller: CallerIdentity,
  items: T[],
): T[] {
  if (caller.isSystemActor) return items;
  return items.filter((item) => typeof item.namespace === 'string' && caller.namespaces.has(item.namespace));
}
