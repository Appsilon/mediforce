import { NextResponse } from 'next/server';
import { hashJoinToken } from '@mediforce/platform-api/services';
import { createRateLimiter, clientAddress, type RateLimitResult } from '@/lib/rate-limit';

/**
 * Shared guards for the public join surface (ADR-0021).
 *
 * `proxy.ts` exempts `/api/join/*` from the session check, exactly as it does
 * `/api/auth/*`: a joiner has no session, and getting one is the whole point of
 * what redemption starts. It is the accepted plain-route exception, not a
 * Server Action, and not the authenticated route adapter.
 *
 * Both halves are routes rather than direct handler calls from the page:
 * `api-boundaries.test.ts` holds the invariant that a handler is only ever
 * reached through the HTTP adapter layer, and an unauthenticated page is
 * exactly the wrong place to start making exceptions to it.
 */

/**
 * A cross-site form post can only send the three form encodings, so demanding
 * JSON blocks a CSRF-driven redemption. Mirrors the `password-login` and
 * `resend-setup-link` guard.
 */
export function requireJsonRequest(request: Request): NextResponse | null {
  if (request.headers.get('content-type')?.startsWith('application/json') !== true) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415 });
  }
  return null;
}

/**
 * Redemption sends mail, so it carries the tighter budget: five attempts per
 * hour per (client address, token) — enough for a fat-fingered email address,
 * far short of a mail relay. ADR-0021 §6: the limit ships with the route.
 */
const redeemLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

/**
 * Preview only reads, so it is looser and keyed by address alone: it has to
 * survive a room full of attendees behind one conference NAT opening the link
 * at the same moment.
 */
const previewLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 });

export function __resetJoinRateLimitsForTests(): void {
  redeemLimiter.reset();
  previewLimiter.reset();
}

export function consumePreviewBudget(request: Request): NextResponse | null {
  return toResponse(previewLimiter.consume(clientAddress(request), Date.now()));
}

/**
 * Keys carry the token's SHA-256, never the token: the limiter's map outlives
 * the request, and a live secret has no business sitting in it.
 */
function limiterKey(request: Request, token: string): string {
  return `${clientAddress(request)}:${hashJoinToken(token)}`;
}

export function consumeRedeemBudget(request: Request, token: string): NextResponse | null {
  return toResponse(redeemLimiter.consume(limiterKey(request, token), Date.now()));
}

function toResponse(result: RateLimitResult): NextResponse | null {
  if (result.ok) return null;
  return NextResponse.json(
    { error: 'Too many attempts. Try again later.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
  );
}
