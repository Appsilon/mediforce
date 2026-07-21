/**
 * NextAuth session-cookie extraction (ADR-0002 §6, PR2).
 *
 * The database-strategy session cookie carries the `auth_sessions.session_token`
 * verbatim. NextAuth names it `authjs.session-token` over http and
 * `__Secure-authjs.session-token` over https (the `__Secure-` prefix is added
 * when secure cookies are on). Both the coarse gate (`proxy.ts`, a
 * `NextRequest`) and the per-route resolver (`api-auth.ts`, a plain `Request`)
 * read the cookie through here, so the name list lives in one place.
 */
const COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const;

/** The cookie name to WRITE — `__Secure-`-prefixed over https, matching what
 *  Auth.js itself sets for its own providers. */
export function sessionCookieName(secure: boolean): string {
  return secure ? COOKIE_NAMES[0] : COOKIE_NAMES[1];
}

interface CookieJar {
  get(name: string): { value: string } | undefined;
}

/** Read the session token from a `NextRequest`/`cookies()` jar. */
export function getSessionCookie(cookies: CookieJar): string | null {
  for (const name of COOKIE_NAMES) {
    const value = cookies.get(name)?.value;
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

/** Read the session token from a raw `Cookie` request header. */
export function getSessionCookieFromHeader(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === '') return null;
  const jar = new Map<string, string>();
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name !== '' && !jar.has(name)) jar.set(name, decodeURIComponent(value));
  }
  for (const name of COOKIE_NAMES) {
    const value = jar.get(name);
    if (value !== undefined && value !== '') return value;
  }
  return null;
}
