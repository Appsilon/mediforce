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
 * Redemption sends mail, so it carries two budgets, and they bound different
 * things (ADR-0021 §6).
 *
 * Per token, ignoring the address entirely: sixty an hour. Nothing a caller
 * sends can move this key — it is the hash of a secret only the holder has —
 * so it is the ceiling that survives a spoofed header, and it is what stops one
 * leaked link from becoming a mail relay. A capped link is additionally bounded
 * by `max_uses` for its whole lifetime; this is what bounds an uncapped one.
 *
 * Per client address, ignoring the token entirely: 120 an hour, same as
 * preview. Neither half of that sentence is incidental:
 *
 *   - Ignoring the token is what makes this budget reachable at all. A key
 *     containing the token hash is one the caller picks, so a script sending a
 *     fresh invalid token per request would get a fresh bucket every time and
 *     charge the Postgres claim unbounded. A budget an attacker can reset is
 *     not a budget.
 *   - 120 is room-sized because the address is not one attendee. A workshop
 *     behind one conference NAT shares a single address across everybody
 *     redeeming the same link, so a low cap here would 429 the room this
 *     feature exists for — the mistake the per-(address, token) budget this
 *     replaced made at five an hour.
 */
const redeemPerTokenLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });
const redeemPerClientLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 });

/**
 * Preview only reads and sends no mail, so it is looser and keyed by address
 * alone: it has to survive a room of attendees behind one conference NAT
 * opening the link at the same moment.
 *
 * The one key here derived from a token carries its SHA-256, never the token
 * itself: a limiter's map outlives the request, and a live secret has no
 * business sitting in it.
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
  // Both are charged on every attempt, and the per-token ceiling is charged
  // first so a caller cannot spend the unspoofable budget more slowly by
  // rotating the spoofable one.
  const perToken = redeemPerTokenLimiter.consume(hashJoinToken(token), now);
  const perClient = redeemPerClientLimiter.consume(clientAddress(request), now);
  return toResponse(perToken.ok ? perClient : perToken);
}

function toResponse(result: RateLimitResult): NextResponse | null {
  if (result.ok) return null;
  return NextResponse.json(
    { error: 'Too many attempts. Try again later.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
  );
}
