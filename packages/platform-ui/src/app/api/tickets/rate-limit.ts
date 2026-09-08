import { createRateLimiter, type RateLimitResult } from '@/lib/rate-limit';

export const DAILY_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

// Per-uid anti-spam ceiling on ticket creation, on the shared keyed limiter
// (`@/lib/rate-limit`) — see there for the multi-instance caveat.
const limiter = createRateLimiter({ limit: DAILY_LIMIT, windowMs: DAY_MS });

export function __resetRateLimitsForTests(): void {
  limiter.reset();
}

export function consumeRateLimit(uid: string, now: number): RateLimitResult {
  return limiter.consume(uid, now);
}
