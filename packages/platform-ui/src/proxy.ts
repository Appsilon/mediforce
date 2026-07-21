import { NextRequest, NextResponse } from 'next/server';
import { getSharedPostgresClient, resolveSessionUserId } from '@mediforce/platform-infra';
import { getSessionCookie } from '@/lib/session-cookie';

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PRODUCTION_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const PUBLIC_ROUTES = new Set<string>(['/api/health']);
const PUBLIC_ROUTE_PATTERNS: RegExp[] = [
  // NextAuth's own endpoints (sign-in, callback, session, csrf, sign-out) —
  // you cannot present a session while obtaining one (ADR-0002 §2.2).
  /^\/api\/auth\//,
  // Per-provider OAuth callback — no user session at this point; the signed
  // state HMAC inside the callback handler is the sole integrity check.
  /^\/api\/oauth\/[^/]+\/callback$/,
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isOriginAllowed(origin: string): boolean {
  return LOCALHOST_RE.test(origin) || PRODUCTION_ORIGINS.includes(origin);
}

function hasValidApiKey(req: NextRequest): boolean {
  const provided = req.headers.get('X-Api-Key');
  const expected = process.env.PLATFORM_API_KEY;
  return Boolean(provided) && Boolean(expected) && provided === expected;
}

/**
 * NextAuth session check (ADR-0002 §6). Replaces the Firebase Bearer
 * verification: the browser carries the httpOnly session cookie, resolved to a
 * uid via a single indexed `auth_sessions` lookup. An expired or revoked
 * session fails here exactly as an invalid token used to. Runs on the Node
 * runtime (see `config.runtime`) so the Postgres driver is available.
 */
async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = getSessionCookie(req.cookies);
  if (token === null) return false;
  const { db } = getSharedPostgresClient();
  const uid = await resolveSessionUserId(db, token);
  return uid !== null;
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function applyCorsHeaders(res: NextResponse, origin: string, isAllowed: boolean): void {
  if (isAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
    res.headers.set('Access-Control-Allow-Credentials', 'true');
  }
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin') ?? '';
  const isAllowed = isOriginAllowed(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    if (isAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
      res.headers.set('Access-Control-Allow-Credentials', 'true');
      res.headers.set('Access-Control-Max-Age', '86400');
    }
    return res;
  }

  // Auth guard: applies to all non-OPTIONS /api/* requests unless public.
  // Either X-Api-Key (server-to-server) or a NextAuth session cookie (signed-in
  // user) is sufficient. Per-endpoint admin gating lives in the handler layer
  // via `assertNamespaceAccess` — this layer only proves the caller is
  // authenticated, not what they may touch.
  const pathname = req.nextUrl.pathname;
  if (!isPublicRoute(pathname)) {
    const apiKeyOk = hasValidApiKey(req);
    const sessionOk = apiKeyOk ? true : await hasValidSession(req);
    if (!apiKeyOk && !sessionOk) {
      const res = unauthorizedResponse();
      applyCorsHeaders(res, origin, isAllowed);
      return res;
    }
  }

  // Add CORS headers to actual responses
  const res = NextResponse.next();
  applyCorsHeaders(res, origin, isAllowed);
  return res;
}

export const config = {
  matcher: '/api/:path*',
  runtime: 'nodejs',
};
