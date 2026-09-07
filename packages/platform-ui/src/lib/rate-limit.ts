/**
 * Keyed, windowed in-memory rate limiter.
 *
 * Generalized out of the ticket route's private bucket when ADR-0021 §6 needed
 * the same shape for `/api/join/*`: a public endpoint that sends mail on demand
 * must ship with its limit, not acquire one later, or it becomes a mail relay.
 *
 * Per-instance and in-memory: on a multi-instance deployment the effective cap
 * is `limit × instances`. That is acceptable for an anti-abuse ceiling — the
 * point is to stop a script, not to meter fairly. A shared store (Postgres or
 * Redis) is the upgrade if stricter enforcement is ever needed; every caller
 * goes through this interface, so it is one file to change.
 */

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Count one attempt against `key`. Rejects once the window's limit is hit. */
  consume(key: string, now: number): RateLimitResult;
  /** Drop every bucket. For tests — a fresh limiter per case, not per process. */
  reset(): void;
}

interface Bucket {
  count: number;
  windowStart: number;
}

export function createRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    consume(key, now) {
      const bucket = buckets.get(key);
      // A window that has fully elapsed is replaced rather than decayed: these
      // are anti-abuse ceilings, not token buckets, and a fixed window is the
      // behaviour the ticket route has always had.
      if (bucket === undefined || now - bucket.windowStart >= options.windowMs) {
        buckets.set(key, { count: 1, windowStart: now });
        return { ok: true };
      }
      if (bucket.count >= options.limit) {
        const retryAfterSeconds = Math.ceil(
          (bucket.windowStart + options.windowMs - now) / 1000,
        );
        return { ok: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
      }
      bucket.count += 1;
      return { ok: true };
    },
    reset() {
      buckets.clear();
    },
  };
}

/**
 * Best-effort client address for keying a public endpoint's limiter.
 *
 * `x-forwarded-for` is spoofable by anything upstream of the reverse proxy, so
 * this is a ceiling on casual abuse, not an identity. Falls back to a single
 * shared key rather than to "unlimited": an unattributable request is still a
 * request, and one bucket for all of them is the safer failure.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first !== '') return first;
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp !== undefined && realIp !== '' ? realIp : 'unknown';
}
