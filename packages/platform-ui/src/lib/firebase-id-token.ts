/**
 * Single source of truth for reading the current user's Firebase ID token
 * in the browser. Both browser-side auth entry points delegate here:
 *
 *   - `apiFetch` (raw fetch wrapper)  →  attaches `Authorization: Bearer <token>`
 *   - `lib/mediforce.ts` (typed client) → supplies it as the `bearerToken` callback
 *
 * Kept deliberately tiny and side-effect-free beyond the lazy Firebase import:
 * unit tests rendering components that transitively depend on this helper
 * must not trigger `getAuth()` in a Node environment without
 * `NEXT_PUBLIC_FIREBASE_API_KEY`.
 *
 * Returns `null` when no user is signed in — the middleware will reject the
 * request with 401, which is the same behavior callers had before.
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  const { auth } = await import('./firebase');
  const user = auth.currentUser;
  return user === null ? null : user.getIdToken();
}
