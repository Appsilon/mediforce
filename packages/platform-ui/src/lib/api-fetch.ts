/**
 * Client-side fetch wrapper that attaches the current user's Firebase ID token
 * as `Authorization: Bearer <token>` so middleware.ts can authenticate the
 * request without requiring the server-only PLATFORM_API_KEY.
 *
 * Use this for every browser-initiated call to internal `/api/*` routes.
 * Server-to-server calls (route handlers, cron, queue workers) should continue
 * to use the `X-Api-Key: ${PLATFORM_API_KEY}` header instead.
 *
 * Firebase auth is imported lazily so unit tests rendering components that
 * transitively depend on this helper do not trigger getAuth() in a
 * node environment without NEXT_PUBLIC_FIREBASE_API_KEY.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});

  if (!headers.has('Authorization')) {
    const { auth } = await import('./firebase');
    const user = auth.currentUser;
    if (user !== null) {
      const token = await user.getIdToken();
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  return fetch(input, { ...init, headers });
}
