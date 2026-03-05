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

function isOriginAllowed(origin: string): boolean {
  return LOCALHOST_RE.test(origin)
    || PRODUCTION_ORIGINS.includes(origin)
    || (HOSTED_APP_RE !== null && HOSTED_APP_RE.test(origin));
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

  // Add CORS headers to actual responses
  const res = NextResponse.next();
  if (isAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  }
  return res;
}

export const config = {
  matcher: '/api/:path*',
};
