/**
 * Helpers for L3 API E2E journeys that need to exercise the `user`-kind
 * caller path — specifically the 404 anti-enumeration response that
 * api-key callers bypass.
 *
 * The default `auth-setup` seeds one user (member of the `test` namespace).
 * These helpers lazily provision a second user (`outsider@mediforce.dev`,
 * member of an `other` namespace only) and mint Firebase ID tokens for both
 * via the auth emulator. The "outsider" user can hit any endpoint to assert
 * cross-namespace access surfaces as 404, while the seeded `test` user
 * verifies the happy path with a real bearer token.
 *
 * Idempotent: subcollection seeds use PATCH upsert so re-running across
 * journeys (each spec runs against the same emulator instance) is safe.
 */
import { TEST_ORG_HANDLE } from './constants';
import {
  createTestUser,
  seedCollection,
  seedSubcollection,
  signInAndGetIdToken,
} from './emulator';

export const TEST_USER_EMAIL = 'test@mediforce.dev';
export const TEST_USER_PASSWORD = 'test123456';

export const OUTSIDER_EMAIL = 'outsider@mediforce.dev';
export const OUTSIDER_PASSWORD = 'outsider123456';
export const OUTSIDER_NAMESPACE = 'other';

export interface UserCaller {
  readonly uid: string;
  readonly idToken: string;
}

export interface MultiNamespaceFixture {
  /** Member of the `test` namespace (seeded by auth-setup). */
  readonly member: UserCaller;
  /** Member of the `other` namespace only — used for 404 anti-enum probes. */
  readonly outsider: UserCaller;
}

/**
 * Ensures the outsider user, the `other` namespace, and the outsider's
 * membership row all exist, then returns fresh ID tokens for both users.
 *
 * Safe to call from any journey's `beforeAll` — the underlying emulator
 * writes are upserts, and Firebase doesn't care if a user already exists
 * (we re-sign-in to mint a token).
 */
export async function setupMultiNamespaceCallers(): Promise<MultiNamespaceFixture> {
  const memberToken = await signInAndGetIdToken(
    TEST_USER_EMAIL,
    TEST_USER_PASSWORD,
  );
  const outsiderUid = await createTestUser(
    OUTSIDER_EMAIL,
    OUTSIDER_PASSWORD,
    'Outsider',
  );

  await seedCollection('namespaces', {
    [OUTSIDER_NAMESPACE]: {
      id: OUTSIDER_NAMESPACE,
      handle: OUTSIDER_NAMESPACE,
      type: 'personal',
      displayName: 'Outsider Org',
      linkedUserId: outsiderUid,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  });
  await seedSubcollection('namespaces', OUTSIDER_NAMESPACE, 'members', {
    [outsiderUid]: {
      id: outsiderUid,
      uid: outsiderUid,
      role: 'owner',
      joinedAt: '2024-01-01T00:00:00.000Z',
    },
  });

  const outsiderToken = await signInAndGetIdToken(
    OUTSIDER_EMAIL,
    OUTSIDER_PASSWORD,
  );

  // The `test` namespace has its members keyed by the seeded user's uid,
  // not their email — we can derive the uid from the token's `sub` claim
  // via the JWT payload (auth emulator tokens are unsigned JWTs).
  const memberUid = decodeUidFromIdToken(memberToken);

  return {
    member: { uid: memberUid, idToken: memberToken },
    outsider: { uid: outsiderUid, idToken: outsiderToken },
  };
}

/** Bearer-token headers for the given user caller. */
export function bearerHeaders(user: UserCaller): Record<string, string> {
  return {
    Authorization: `Bearer ${user.idToken}`,
    'Content-Type': 'application/json',
  };
}

/** Shared X-Api-Key headers — convenience for journeys that mix both. */
export function apiKeyHeaders(): Record<string, string> {
  const apiKey = process.env.PLATFORM_API_KEY ?? 'test-api-key';
  return { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
}

export { TEST_ORG_HANDLE };

function decodeUidFromIdToken(idToken: string): string {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    throw new Error('Malformed ID token');
  }
  // Base64url → base64 → JSON
  const payloadSegment = parts[1] ?? '';
  const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  const payload = JSON.parse(json) as { sub?: unknown; user_id?: unknown };
  const uid = typeof payload.sub === 'string'
    ? payload.sub
    : typeof payload.user_id === 'string' ? payload.user_id : '';
  if (uid === '') {
    throw new Error('ID token missing sub/user_id claim');
  }
  return uid;
}
