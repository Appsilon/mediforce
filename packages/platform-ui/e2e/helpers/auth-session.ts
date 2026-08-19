import {
  authUsers,
  createDatabaseSession,
  createPostgresClient,
  SESSION_TTL_MS,
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
 * Workspace package exports point directly at source TypeScript, so the
 * drizzle primitives resolve without a build step.
 */

type PostgresConnection = ReturnType<typeof createPostgresClient>;

/** Open a drizzle Postgres client for E2E seeding. Caller closes it. */
export function openPostgresClient(): PostgresConnection {
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
  { client, db }: PostgresConnection,
  user: { userId: string; email: string; name: string },
): Promise<string> {
  // `auth_users.email` is unique (plus a unique `lower(email)` index), so a row
  // holding this email under a *different* id makes the upsert below fail —
  // `onConflictDoUpdate` targets `id` and never sees the email collision. Every
  // caller now pins `TEST_USER_ID`, but a database seeded before that fix still
  // holds the email under a random uuid, so drop the impostor — the FK cascade
  // clears its sessions/accounts/roles and the fixture is re-seeded under the
  // stable id. Raw SQL, like the sibling seed helpers: `drizzle-orm` is not a
  // declared `platform-ui` dependency, so importing its operators here would
  // only resolve by pnpm hoisting.
  await client`
    DELETE FROM auth_users WHERE lower(email) = lower(${user.email}) AND id <> ${user.userId}
  `;

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
