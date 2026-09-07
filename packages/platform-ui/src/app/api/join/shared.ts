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
 * Redemption sends mail, so it carries two budgets, and the second is the one
 * that actually holds (ADR-0021 §6).
 *
 * Per (client address, token): five an hour. Enough for a fat-fingered email
 * address, and it costs an ordinary attendee nothing. But the address half is
 * derived from `x-forwarded-for`, which the client supplies — a script that
 * rotates it gets a fresh bucket per request, so this budget alone is a
 * suggestion.
 *
 * Per token, ignoring the address entirely: sixty an hour. Nothing a caller
 * sends can move this key — it is the hash of a secret only the holder has —
 * so it is the ceiling that survives a spoofed header. Sixty comfortably
 * covers a room signing up at once and is nowhere near a mail relay. A capped
 * link is additionally bounded by `max_uses` for its whole lifetime; this is
 * what bounds an uncapped one.
 */
const redeemPerClientLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
const redeemPerTokenLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });

/**
 * Preview only reads and sends no mail, so it is looser and keyed by address
 * alone: it has to survive a room of attendees behind one conference NAT
 * opening the link at the same moment.
 *
 * Keys everywhere here carry the token's SHA-256, never the token: a limiter's
 * map outlives the request, and a live secret has no business sitting in it.
 */
const previewLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 });

export function __resetJoinRateLimitsForTests(): void {
  redeemPerClientLimiter.reset();
  redeemPerTokenLimiter.reset();
  previewLimiter.reset();
}

export function consumePreviewBudget(request: Request): NextResponse | null {
  return toResponse(previewLimiter.consume(clientAddress(request), Date.now()));
}

export function consumeRedeemBudget(request: Request, token: string): NextResponse | null {
  const now = Date.now();
  const tokenHash = hashJoinToken(token);
  // Both are charged on every attempt, and the per-token ceiling is charged
  // first so a caller cannot spend the unspoofable budget more slowly by
  // rotating the spoofable one.
  const perToken = redeemPerTokenLimiter.consume(tokenHash, now);
  const perClient = redeemPerClientLimiter.consume(
    `${clientAddress(request)}:${tokenHash}`,
    now,
  );
  return toResponse(perToken.ok ? perClient : perToken);
}

function toResponse(result: RateLimitResult): NextResponse | null {
  if (result.ok) return null;
  return NextResponse.json(
    { error: 'Too many attempts. Try again later.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
  );
}
