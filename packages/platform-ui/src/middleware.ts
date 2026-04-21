import { NextRequest, NextResponse } from 'next/server';

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
const HOSTED_APP_RE = PROJECT_ID
  ? new RegExp(`^https://[\\w-]+--${PROJECT_ID}\\.[\\w.-]+\\.hosted\\.app$`)
  : null;
const PRODUCTION_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const PUBLIC_ROUTES = new Set<string>(['/api/health', '/api/oauth/callback']);

function isOriginAllowed(origin: string): boolean {
  return LOCALHOST_RE.test(origin)
    || PRODUCTION_ORIGINS.includes(origin)
    || (HOSTED_APP_RE !== null && HOSTED_APP_RE.test(origin));
}

function requireApiKey(req: NextRequest): NextResponse | null {
  const provided = req.headers.get('X-Api-Key');
  const expected = process.env.PLATFORM_API_KEY;
  if (!provided || !expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

function applyCorsHeaders(res: NextResponse, origin: string, isAllowed: boolean): void {
  if (isAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  }
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const isAllowed = isOriginAllowed(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    if (isAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
      res.headers.set('Access-Control-Max-Age', '86400');
    }
    return res;
  }

  // Auth guard: applies to all non-OPTIONS /api/* requests unless public
  const pathname = req.nextUrl.pathname;
  if (!PUBLIC_ROUTES.has(pathname)) {
    let authResponse: NextResponse | null;
    if (pathname.startsWith('/api/admin/')) {
      // TODO(#218): tighten to PLATFORM_ADMIN_API_KEY when tier split lands
      authResponse = requireApiKey(req);
    } else {
      authResponse = requireApiKey(req);
    }
    if (authResponse !== null) {
      applyCorsHeaders(authResponse, origin, isAllowed);
      return authResponse;
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
