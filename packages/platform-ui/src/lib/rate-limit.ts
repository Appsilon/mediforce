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
  /** Live bucket count. Exposed so the eviction guarantee is testable. */
  size(): number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Sweep expired buckets once the map crosses this. A limiter whose key includes
 * anything caller-influenced (a client address, a token) would otherwise grow
 * without bound: entries are only ever replaced on a same-key hit, so a script
 * rotating its key adds a permanent entry per request. Sweeping on write keeps
 * that bounded by the number of keys actually active inside one window, with no
 * timer to own.
 */
const SWEEP_THRESHOLD = 10_000;

export function createRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= options.windowMs) buckets.delete(key);
    }
  }

  return {
    consume(key, now) {
      const bucket = buckets.get(key);
      // A window that has fully elapsed is replaced rather than decayed: these
      // are anti-abuse ceilings, not token buckets, and a fixed window is the
      // behaviour the ticket route has always had.
      if (bucket === undefined || now - bucket.windowStart >= options.windowMs) {
        if (buckets.size >= SWEEP_THRESHOLD) sweep(now);
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
    size() {
      return buckets.size;
    },
  };
}

/**
 * Best-effort client address for keying a public endpoint's limiter.
 *
 * Takes the LAST hop of `x-forwarded-for`, not the first. Every proxy in front
 * of us appends (nginx `proxy_add_x_forwarded_for`, Caddy, the same convention
 * everywhere), so the last entry is the address our own reverse proxy observed
 * and the earlier ones are whatever the client chose to send. Reading the first
 * — the conventional "original client", and what an audit record wants — would
 * hand a caller a fresh limiter key per request simply by rotating a header,
 * which is a limiter that does not limit.
 *
 * `password-login`'s `clientIpFrom` deliberately still reads the first hop:
 * it records who the request claims to be for the sign-in audit trail, where
 * the conventional value is the useful one and its spoofability is understood.
 * The two look alike and want opposite things, which is why they are not one
 * function.
 *
 * Even the last hop is only a ceiling on casual abuse, not an identity — see
 * `consumeRedeemBudget` for the budget that does not depend on it at all.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const hops = (forwarded ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  const lastHop = hops[hops.length - 1];
  if (lastHop !== undefined) return lastHop;
  const realIp = request.headers.get('x-real-ip')?.trim();
  // An unattributable request is still a request; one shared bucket for all of
  // them is the safer failure than treating them as unlimited.
  return realIp !== undefined && realIp !== '' ? realIp : 'unknown';
}
