import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '../postgres/client';
import { authSessions } from '../postgres/schema/auth-session';
import { userRoles } from '../postgres/schema/user-role';

/**
 * NextAuth database-session primitives (ADR-0002 §3, PR2).
 *
 * These back the auth boundary (`proxy.ts` coarse gate + `resolveCallerIdentity`
 * per-route resolver both resolve the caller uid from the httpOnly session
 * cookie) and the Credentials-provider session workaround in `auth.ts`. They
 * live here — not in `auth.ts` — so they are shared by the machine-facing
 * boundary and covered by L2 tests against real Postgres, independent of the
 * NextAuth wiring.
 *
 * The database strategy stores the session token verbatim in the cookie, so a
 * request is resolved by a single indexed lookup on `auth_sessions`, and an
 * expired or deleted row is an immediate 401 on the next request (revocation).
 */

/** Default database-session lifetime — 30 days, matching NextAuth's default. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve a session-cookie token to its user id, or `null` when the token is
 * unknown or the session has expired. Expiry is enforced in SQL (`expires >
 * now()`) so a lapsed session is rejected without a separate clock read.
 */
export async function resolveSessionUserId(
  db: Database,
  sessionToken: string,
): Promise<string | null> {
  if (sessionToken === '') return null;
  const rows = await db
    .select({ userId: authSessions.userId })
    .from(authSessions)
    .where(and(eq(authSessions.sessionToken, sessionToken), gt(authSessions.expires, new Date())))
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * Global process-domain roles for a user (`user_roles`, ADR-0002 §1.4). Feeds
 * the NextAuth `session` callback so the browser's `useViewerIdentity` reads
 * `session.user.roles` instead of the old Firebase custom claim.
 */
export async function getUserRoles(db: Database, uid: string): Promise<string[]> {
  const rows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.uid, uid));
  return rows.map((r) => r.role);
}

/**
 * Insert a database session row. Used by the Credentials-provider workaround
 * (Auth.js does not persist a database session for credential logins on its
 * own) and by the E2E setup that seeds a session directly. The caller owns the
 * token; use a cryptographically random value.
 */
export async function createDatabaseSession(
  db: Database,
  params: { sessionToken: string; userId: string; expires: Date },
): Promise<void> {
  await db.insert(authSessions).values({
    sessionToken: params.sessionToken,
    userId: params.userId,
    expires: params.expires,
  });
}
