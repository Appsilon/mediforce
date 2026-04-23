import { getFirebaseIdToken } from './firebase-id-token';

/**
 * Client-side fetch wrapper that attaches the current user's Firebase ID token
 * as `Authorization: Bearer <token>` so middleware.ts can authenticate the
 * request without requiring the server-only PLATFORM_API_KEY.
 *
 * Use this for browser-initiated calls to internal `/api/*` routes that have
 * not yet been migrated onto the typed `Mediforce` client. Once an endpoint
 * lives in `@mediforce/platform-api/contract`, prefer `mediforce.X.y()` from
 * `lib/mediforce.ts` — both paths share the same `getFirebaseIdToken()`
 * helper, so the wire-level auth header is identical.
 *
 * Server-to-server calls (route handlers, cron, queue workers) use
 * `X-Api-Key: ${PLATFORM_API_KEY}` instead — middleware accepts either.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});

  if (!headers.has('Authorization')) {
    const token = await getFirebaseIdToken();
    if (token !== null) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  return fetch(input, { ...init, headers });
}
