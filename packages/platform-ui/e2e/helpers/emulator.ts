const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-mediforce';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const API_KEY = 'fake-api-key';

export async function clearEmulators() {
  await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  });
  await fetch(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
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

export async function seedCollection(
  collection: string,
  documents: Record<string, Record<string, unknown>>,
) {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  for (const [docId, docData] of Object.entries(documents)) {
    // Use PATCH to upsert — avoids errors if document already exists from a previous run
    const res = await fetch(`${basePath}/${collection}/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(docData) }),
    });
    if (!res.ok) {
      throw new Error(`Failed to seed ${collection}/${docId}: ${await res.text()}`);
    }
  }
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
        headers: { 'Content-Type': 'application/json' },
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
