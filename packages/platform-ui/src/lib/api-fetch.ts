/**
 * Client-side fetch wrapper for browser-initiated calls to internal `/api/*`
 * routes that have not yet been migrated onto the typed `Mediforce` client.
 *
 * After the Firebase Auth exit (ADR-0002 §6) the browser authenticates with
 * the NextAuth httpOnly session cookie, which rides same-origin requests
 * automatically — this wrapper no longer attaches an `Authorization` header.
 * It stays as the sanctioned browser fetch entry point (prefer `mediforce.X.y()`
 * once an endpoint lives in `@mediforce/platform-api/contract`); `credentials:
 * 'same-origin'` is pinned so the session cookie is always sent even if a caller
 * passes a cross-cutting `init`.
 *
 * Server-to-server calls (route handlers, cron, queue workers) use
 * `X-Api-Key: ${PLATFORM_API_KEY}` instead — the proxy accepts either.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { credentials: 'same-origin', ...init });
}
