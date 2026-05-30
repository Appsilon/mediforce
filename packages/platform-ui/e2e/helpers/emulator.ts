const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-mediforce';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
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

// Convert a JS value to Firestore REST API value format
function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function toFirestoreFields(doc: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

// Firestore emulator accepts `Authorization: Bearer owner` to bypass security rules.
// Required for seed / fixture writes — without it, rules that require `request.auth != null`
// reject unauthenticated REST calls with PERMISSION_DENIED.
const EMULATOR_ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer owner',
};

export async function seedCollection(
  collection: string,
  documents: Record<string, Record<string, unknown>>,
) {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  for (const [docId, docData] of Object.entries(documents)) {
    // Use PATCH to upsert — avoids errors if document already exists from a previous run
    const res = await fetch(`${basePath}/${collection}/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      headers: EMULATOR_ADMIN_HEADERS,
      body: JSON.stringify({ fields: toFirestoreFields(docData) }),
    });
    if (!res.ok) {
      throw new Error(`Failed to seed ${collection}/${docId}: ${await res.text()}`);
    }
  }
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

export async function patchDocumentFields(
  collection: string,
  docId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const updateMask = Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const res = await fetch(
    `${basePath}/${collection}/${encodeURIComponent(docId)}?${updateMask}`,
    {
      method: 'PATCH',
      headers: EMULATOR_ADMIN_HEADERS,
      body: JSON.stringify({ fields: toFirestoreFields(fields) }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to patch ${collection}/${docId}: ${await res.text()}`);
  }
}

/** Delete a single Firestore document by its full path
 *  (e.g. `namespaces/test/agentOAuthTokens/oauth-test-agent__github-mcp`).
 *  Each path segment is URL-encoded so segments containing `#`, `?`, spaces,
 *  or other URL-special characters route correctly. Missing docs are a
 *  no-op — callers can use this for idempotent cleanup. */
export async function deleteDocument(docPath: string): Promise<void> {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${basePath}/${encodedPath}`, {
    method: 'DELETE',
    headers: EMULATOR_ADMIN_HEADERS,
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return;
  if (!res.ok) {
    throw new Error(`Failed to delete ${docPath}: ${await res.text()}`);
  }
}

/** Fetch the raw Firestore `fields` map for a document via the emulator REST API.
 *  Returns `null` if the doc does not exist. Used to assert field-level shape
 *  (e.g. that an optional field was deleted, not stored as null). */
export async function getDocumentFields(
  collection: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(`${basePath}/${collection}/${encodeURIComponent(docId)}`, {
    headers: EMULATOR_ADMIN_HEADERS,
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to read ${collection}/${docId}: ${await res.text()}`);
  }
  const data = (await res.json()) as { fields?: Record<string, unknown> };
  return data.fields ?? {};
}

export async function seedSubcollection(
  parentCollection: string,
  parentId: string,
  subcollection: string,
  documents: Record<string, Record<string, unknown>>,
) {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  for (const [docId, docData] of Object.entries(documents)) {
    // Use PATCH to upsert — avoids errors if document already exists from a previous run
    const res = await fetch(
      `${basePath}/${parentCollection}/${parentId}/${subcollection}/${docId}`,
      {
        method: 'PATCH',
        headers: EMULATOR_ADMIN_HEADERS,
        body: JSON.stringify({ fields: toFirestoreFields(docData) }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Failed to seed ${parentCollection}/${parentId}/${subcollection}/${docId}: ${await res.text()}`,
      );
    }
  }
}
