import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';

/**
 * Postgres-backed test-user helpers (ADR-0002 PR2). Firebase Auth and its
 * emulator are gone — identity now lives in `auth_users` and sessions in
 * `auth_sessions`. These helpers seed those rows directly, mirroring the raw
 * `postgres-js` approach in `postgres-seed.ts` (Playwright resolves the
 * `@mediforce/source` condition, but a self-contained SQL helper keeps this
 * file dependency-light and matches the seed's proven pattern).
 *
 * The filename is retained to avoid churning the ~6 journeys that import from
 * it; the "emulator" is historical.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to seed auth users for E2E.');
  }
  return postgres(url, { max: 1, onnotice: () => {} });
}

/**
 * Upsert an `auth_users` row for an email/password test user and return its id.
 * The password is bcrypt-hashed into `password_hash` so the
 * `/api/auth/password-login` route (`ENABLE_PASSWORD_AUTH=true`) authenticates
 * the same user through the login page. `email_verified` is set so a later Google
 * sign-in would link by verified email (ADR-0002 §4b).
 *
 * Idempotent: re-running upserts the name + password and returns the stable
 * id, so a Playwright retry after a password change re-seeds cleanly.
 */
export async function createTestUser(
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  const sql = connect();
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const rows = await sql<{ id: string }[]>`
      INSERT INTO auth_users (id, email, name, email_verified, password_hash)
      VALUES (${randomUUID()}, ${email}, ${displayName}, now(), ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        email_verified = now(),
        updated_at = now()
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`Failed to upsert auth user ${email}`);
    return id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Open a database session for an existing password user and return the session
 * token — the `authjs.session-token` cookie value a `user`-kind API caller
 * sends (vs the `apiKey`-kind path most journeys share). Replaces the former
 * Firebase ID-token mint; the token resolves through `resolveSessionUserId`
 * exactly like a browser session.
 *
 * The password is verified for parity with the real Credentials flow so a
 * stale-password retry surfaces as a clear error instead of a silent session.
 */
export async function signInAndGetSessionCookie(
  email: string,
  password: string,
): Promise<string> {
  const sql = connect();
  try {
    const users = await sql<{ id: string; password_hash: string | null }[]>`
      SELECT id, password_hash FROM auth_users WHERE email = ${email}
    `;
    const user = users[0];
    if (!user) throw new Error(`No auth_users row for ${email}`);
    if (user.password_hash !== null && !(await bcrypt.compare(password, user.password_hash))) {
      throw new Error(`Password mismatch for ${email}`);
    }
    const sessionToken = randomBytes(32).toString('hex');
    await sql`
      INSERT INTO auth_sessions (session_token, user_id, expires)
      VALUES (${sessionToken}, ${user.id}, ${new Date(Date.now() + SESSION_TTL_MS)})
    `;
    return sessionToken;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Delete a single `auth_users` row by email, if it exists. The FK cascade
 * removes its `auth_sessions`/`auth_accounts` rows. Scoped — never wipes the
 * shared auth-setup user. Used to make a journey's `beforeAll` idempotent
 * across Playwright retries (a retry after the test changed the user's
 * password would otherwise re-sign-in with the now-stale temp password).
 */
export async function deleteAuthUser(email: string): Promise<void> {
  const sql = connect();
  try {
    await sql`DELETE FROM auth_users WHERE email = ${email}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
