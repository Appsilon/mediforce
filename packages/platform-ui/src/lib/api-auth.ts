import { NextResponse } from 'next/server';
import { getSharedPostgresClient, resolveSessionUserId } from '@mediforce/platform-infra';
import type { NamespaceRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { getSessionCookieFromHeader } from './session-cookie';

// Re-export the canonical type from platform-api so route handlers can import
// it from a single place. Pure-handler code in @mediforce/platform-api uses
// the same shape — the Next.js layer only adds the resolution-from-Request
// part below.
export type { CallerIdentity };
export { callerCanAccess, assertNamespaceAccess, filterByCaller } from '@mediforce/platform-api/auth';

/**
 * Resolve caller identity from a request.
 * API-key callers get unrestricted access. Browser callers are resolved from
 * the NextAuth httpOnly session cookie (ADR-0002 §6) — no `Authorization`
 * header — into their namespace membership. Returns NextResponse 401 on auth
 * failure.
 *
 * For routes built on `createRouteAdapter`, the adapter calls this internally —
 * you don't need to invoke it directly. Inline (non-adapted) routes still
 * call it as a first step.
 */
export async function resolveCallerIdentity(
  request: Request,
  namespaceRepo: NamespaceRepository,
): Promise<CallerIdentity | NextResponse> {
  // Both PLATFORM_API_KEY and PLATFORM_ADMIN_API_KEY mint the same apiKey
  // identity (`isSystemActor: true`). The two env vars exist for operator
  // ergonomics — historic deployments used distinct keys per tier — but at
  // the auth boundary they're interchangeable. Per-user PATs (#376) replace
  // this whole branch once issued; until then both keys are operator-issued
  // and trusted.
  const apiKey = request.headers.get('X-Api-Key');
  const expectedKey = process.env.PLATFORM_API_KEY;
  const adminKey = process.env.PLATFORM_ADMIN_API_KEY;
  const apiKeyMatchesPrimary =
    apiKey !== null && apiKey !== '' && expectedKey !== undefined && expectedKey !== '' && apiKey === expectedKey;
  const apiKeyMatchesAdmin =
    apiKey !== null && apiKey !== '' && adminKey !== undefined && adminKey !== '' && apiKey === adminKey;
  if (apiKeyMatchesPrimary || apiKeyMatchesAdmin) {
    return { kind: 'apiKey', isSystemActor: true };
  }

  const sessionToken = getSessionCookieFromHeader(request.headers.get('cookie'));
  if (sessionToken === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { db } = getSharedPostgresClient();
  const uid = await resolveSessionUserId(db, sessionToken);
  if (uid === null) {
    return NextResponse.json({ error: 'Unauthorized — invalid session' }, { status: 401 });
  }

  const memberships = await namespaceRepo.getMembershipsForUser(uid);
  return {
    kind: 'user',
    uid,
    namespaces: new Set(memberships.map((m) => m.handle)),
    namespaceRoles: new Map(memberships.map((m) => [m.handle, m.role] as const)),
    // Carried so a handler that revokes the user's sessions (password change)
    // can spare the one making the request.
    sessionToken,
    isSystemActor: false,
  };
}

/**
 * Resolve the signed-in user's uid from the NextAuth session cookie (ADR-0002
 * §6), or `null` when there is no valid session. For routes that only need the
 * uid (not the full `CallerIdentity` membership set) — file-serving and the
 * agent-OAuth routes verify the session here as defence-in-depth on top of the
 * proxy gate.
 */
export async function resolveSessionUid(request: Request): Promise<string | null> {
  const sessionToken = getSessionCookieFromHeader(request.headers.get('cookie'));
  if (sessionToken === null) return null;
  const { db } = getSharedPostgresClient();
  return resolveSessionUserId(db, sessionToken);
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
