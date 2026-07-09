const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-mediforce';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const API_KEY = 'fake-api-key';

/** Reset the Auth emulator's accounts. Firestore is fully removed (ADR-0001
 *  #534) — server-side state lives in Postgres and is reset by
 *  `seedPostgresNamespace`'s TRUNCATE. */
export async function clearEmulators() {
  await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  });
}

export async function createTestUser(
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  const signUpRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
    },
  );

  if (signUpRes.ok) {
    const data = await signUpRes.json();
    return data.localId as string;
  }

  // User may already exist if emulator state persisted — sign in instead
  const signInRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!signInRes.ok) throw new Error(`Failed to create or sign in user: ${await signInRes.text()}`);
  const data = await signInRes.json();
  return data.localId as string;
}

/**
 * Sign in an existing emulator user and return a fresh Firebase ID token.
 * Used by L3 API E2E journeys that need a `user`-kind caller (vs the
 * `apiKey`-kind shared with most other journeys) — for example to exercise
 * the 404 anti-enumeration path that api-key callers bypass.
 */
export async function signInAndGetIdToken(
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to sign in ${email}: ${await res.text()}`);
  }
  const data = (await res.json()) as { idToken: string };
  return data.idToken;
}

/** Delete a single Firebase Auth emulator account by email, if it exists.
 *  Scoped delete — unlike `clearEmulators`, it leaves the shared auth-setup
 *  user and seeded data intact. Used to make a journey's `beforeAll`
 *  idempotent across Playwright retries: a retry after the test already
 *  changed the user's password would otherwise re-sign-in with the now-stale
 *  temp password and fail with INVALID_PASSWORD. */
export async function deleteAuthUser(email: string): Promise<void> {
  const localId = await getUserIdByEmail(email);
  if (localId === null) return;
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to delete auth user ${email}: ${await res.text()}`);
  }
}

export async function getUserIdByEmail(email: string): Promise<string | null> {
  const res = await fetch(
    `${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { userInfo?: Array<{ localId: string; email?: string }> };
  const user = data.userInfo?.find((u) => u.email === email);
  return user?.localId ?? null;
}
