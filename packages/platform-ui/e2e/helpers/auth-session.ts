import {
  authUsers,
  createDatabaseSession,
  createPostgresClient,
  SESSION_TTL_MS,
  type Database,
} from '@mediforce/platform-infra';

/**
 * NextAuth database-session seeding for E2E (ADR-0002 §7, PLAN §7).
 *
 * Replaces the old Firebase-emulator sign-in dance: instead of driving a login
 * page and capturing the resulting client state, we upsert an `auth_users` row
 * and open a database session directly, then hand the session token to
 * Playwright as the `authjs.session-token` cookie. This exercises the same
 * cookie → `auth_sessions` lookup the real login produces (session-cookie.ts,
 * `resolveSessionUserId`), but without a browser round trip.
 *
 * Session creation goes through `createDatabaseSession` — the single primitive
 * shared by the auth boundary and the `/api/auth/password-login` route — so the
 * seeded session is byte-identical to a production one.
 *
 * Resolution note: the `@mediforce/source` condition (set by the `test:e2e`
 * npm script via `NODE_OPTIONS`) maps `@mediforce/platform-infra` to its
 * `src/index.ts`, so the drizzle primitives resolve without a build step.
 */

/** Open a drizzle Postgres client for E2E seeding. Caller closes it. */
export function openPostgresClient(): { client: ReturnType<typeof createPostgresClient>['client']; db: Database } {
  return createPostgresClient();
}

function newSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

/**
 * Upsert the `auth_users` row for a user (verified email so a later Google
 * sign-in links by verified email — ADR-0002 §4b) and open a database session
 * for it. Returns the session token that becomes the `authjs.session-token`
 * cookie value.
 */
export async function seedAuthSession(
  db: Database,
  user: { userId: string; email: string; name: string },
): Promise<string> {
  await db
    .insert(authUsers)
    .values({
      id: user.userId,
      email: user.email,
      name: user.name,
      emailVerified: new Date(),
    })
    .onConflictDoUpdate({
      target: authUsers.id,
      set: { email: user.email, name: user.name, emailVerified: new Date() },
    });

  const sessionToken = newSessionToken();
  await createDatabaseSession(db, {
    sessionToken,
    userId: user.userId,
    expires: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sessionToken;
}
