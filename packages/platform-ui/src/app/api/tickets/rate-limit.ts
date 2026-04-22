export const DAILY_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

type RateLimitBucket = { count: number; windowStart: number };

// Per-instance in-memory limiter. On multi-instance deployments the effective
// cap is DAILY_LIMIT × instances — acceptable for an anti-spam ceiling; move to
// Firestore if stricter enforcement becomes necessary.
const rateLimitBuckets = new Map<string, RateLimitBucket>();

export function __resetRateLimitsForTests(): void {
  rateLimitBuckets.clear();
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function consumeRateLimit(uid: string, now: number): RateLimitResult {
  const bucket = rateLimitBuckets.get(uid);
  if (bucket === undefined || now - bucket.windowStart >= DAY_MS) {
    rateLimitBuckets.set(uid, { count: 1, windowStart: now });
    return { ok: true };
  }
  if (bucket.count >= DAILY_LIMIT) {
    const retryAfterSeconds = Math.ceil((bucket.windowStart + DAY_MS - now) / 1000);
    return { ok: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }
  bucket.count += 1;
  return { ok: true };
}
