/**
 * Helpers for L3 API E2E journeys that need to exercise the `user`-kind
 * caller path — specifically the 404 anti-enumeration response that
 * api-key callers bypass.
 *
 * The default `auth-setup` seeds one user (member of the `test` namespace).
 * These helpers lazily provision a second user (`outsider@mediforce.dev`,
 * member of an `other` namespace only) and open NextAuth database sessions for
 * both (ADR-0002 §6). The "outsider" user can hit any endpoint to assert
 * cross-namespace access surfaces as 404, while the seeded `test` user
 * verifies the happy path with a real session cookie.
 *
 * Idempotent: the Postgres namespace/member seeds use `ON CONFLICT DO
 * NOTHING` so re-running across journeys (each spec shares one database) is
 * safe.
 */
import { TEST_ORG_HANDLE, TEST_USER_ID } from './constants';
import { createTestUser, signInAndGetSessionCookie } from './emulator';
import { seedPostgresPersonalNamespace } from './postgres-seed';

export const TEST_USER_EMAIL = 'test@mediforce.dev';
export const TEST_USER_PASSWORD = 'test123456';

export const OUTSIDER_EMAIL = 'outsider@mediforce.dev';
export const OUTSIDER_PASSWORD = 'outsider123456';
export const OUTSIDER_NAMESPACE = 'other';

export interface UserCaller {
  readonly uid: string;
  /** `auth_sessions.session_token` — the `authjs.session-token` cookie value. */
  readonly sessionCookie: string;
}

export interface MultiNamespaceFixture {
  /** Member of the `test` namespace (seeded by auth-setup). */
  readonly member: UserCaller;
  /** Member of the `other` namespace only — used for 404 anti-enum probes. */
  readonly outsider: UserCaller;
}

/**
 * Ensures the outsider user, the `other` namespace, and the outsider's
 * membership row all exist, then opens fresh database sessions for both users.
 *
 * Safe to call from any journey's `beforeAll` — the Postgres seed upserts, and
 * the auth-user upsert + session insert tolerate a pre-existing user.
 */
export async function setupMultiNamespaceCallers(): Promise<MultiNamespaceFixture> {
  // The shared test user is seeded by auth-setup; ensure a password + session
  // exist here too so this fixture also works when the api project runs alone.
  const memberUid = await createTestUser(TEST_USER_EMAIL, TEST_USER_PASSWORD, 'Test User');
  const memberCookie = await signInAndGetSessionCookie(TEST_USER_EMAIL, TEST_USER_PASSWORD);

  const outsiderUid = await createTestUser(OUTSIDER_EMAIL, OUTSIDER_PASSWORD, 'Outsider');
  await seedPostgresPersonalNamespace(OUTSIDER_NAMESPACE, outsiderUid, 'Outsider Org');
  const outsiderCookie = await signInAndGetSessionCookie(OUTSIDER_EMAIL, OUTSIDER_PASSWORD);

  return {
    member: { uid: memberUid, sessionCookie: memberCookie },
    outsider: { uid: outsiderUid, sessionCookie: outsiderCookie },
  };
}

/** Session-cookie headers for the given user caller (the `user`-kind path). */
export function sessionCookieHeaders(user: UserCaller): Record<string, string> {
  return {
    Cookie: `authjs.session-token=${user.sessionCookie}`,
    'Content-Type': 'application/json',
  };
}

/** Shared X-Api-Key headers — convenience for journeys that mix both. */
export function apiKeyHeaders(): Record<string, string> {
  const apiKey = process.env.PLATFORM_API_KEY ?? 'test-api-key';
  return { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
}

export { TEST_ORG_HANDLE, TEST_USER_ID };
