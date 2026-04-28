import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, createRemoteJWKSet, decodeJwt, type JWTPayload } from 'jose';

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
const HOSTED_APP_RE = PROJECT_ID
  ? new RegExp(`^https://[\\w-]+--${PROJECT_ID}\\.[\\w.-]+\\.hosted\\.app$`)
  : null;
const PRODUCTION_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const PUBLIC_ROUTES = new Set<string>(['/api/health']);
const PUBLIC_ROUTE_PATTERNS: RegExp[] = [
  // Per-provider OAuth callback — no user session at this point; the signed
  // state HMAC inside the callback handler is the sole integrity check.
  /^\/api\/oauth\/[^/]+\/callback$/,
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks === null) {
    cachedJwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  }
  return cachedJwks;
}

function isOriginAllowed(origin: string): boolean {
  return LOCALHOST_RE.test(origin)
    || PRODUCTION_ORIGINS.includes(origin)
    || (HOSTED_APP_RE !== null && HOSTED_APP_RE.test(origin));
}

function hasValidApiKey(req: NextRequest): boolean {
  const provided = req.headers.get('X-Api-Key');
  const expected = process.env.PLATFORM_API_KEY;
  return Boolean(provided) && Boolean(expected) && provided === expected;
}

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match !== null ? (match[1] ?? null) : null;
}

function checkEmulatorClaims(payload: JWTPayload, projectId: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return false;
  if (payload.aud !== projectId) return false;
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss) return false;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return false;
  return true;
}

async function hasValidFirebaseToken(req: NextRequest): Promise<boolean> {
  const token = extractBearer(req);
  if (token === null) return false;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (typeof projectId !== 'string' || projectId.length === 0) return false;

  try {
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
      const payload = decodeJwt(token);
      return checkEmulatorClaims(payload, projectId);
    }
    await jwtVerify(token, getJwks(), {
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
    });
    return true;
  } catch {
    return false;
  }
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function applyCorsHeaders(res: NextResponse, origin: string, isAllowed: boolean): void {
  if (isAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization');
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin') ?? '';
  const isAllowed = isOriginAllowed(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    if (isAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization');
      res.headers.set('Access-Control-Max-Age', '86400');
    }
    return res;
  }

  // Auth guard: applies to all non-OPTIONS /api/* requests unless public.
  // Either X-Api-Key (server-to-server) or Authorization: Bearer <Firebase ID token>
  // (signed-in user) is sufficient. /api/admin/* will tighten to PLATFORM_ADMIN_API_KEY
  // once #218 lands — both tiers currently share PLATFORM_API_KEY.
  const pathname = req.nextUrl.pathname;
  if (!isPublicRoute(pathname)) {
    const apiKeyOk = hasValidApiKey(req);
    const bearerOk = apiKeyOk ? true : await hasValidFirebaseToken(req);
    if (!apiKeyOk && !bearerOk) {
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
};
