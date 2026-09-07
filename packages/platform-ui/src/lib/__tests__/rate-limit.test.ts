import { describe, it, expect } from 'vitest';
import { clientAddress, createRateLimiter } from '../rate-limit';

describe('createRateLimiter', () => {
  it('allows up to the limit inside one window, then rejects', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });

    expect(limiter.consume('k', 0)).toEqual({ ok: true });
    expect(limiter.consume('k', 100)).toEqual({ ok: true });
    expect(limiter.consume('k', 200)).toEqual({ ok: true });
    expect(limiter.consume('k', 300)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('keys are independent — one caller cannot spend another’s budget', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.consume('a', 0).ok).toBe(true);
    expect(limiter.consume('b', 0).ok).toBe(true);
    expect(limiter.consume('a', 0).ok).toBe(false);
  });

  it('starts a fresh window once the old one has fully elapsed', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.consume('k', 0).ok).toBe(true);
    expect(limiter.consume('k', 999).ok).toBe(false);
    expect(limiter.consume('k', 1000).ok).toBe(true);
  });

  it('reports a retry-after of at least one second, never zero', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.consume('k', 0);

    const result = limiter.consume('k', 999.5);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  // A limiter whose key includes anything caller-influenced grows one permanent
  // entry per request otherwise, which is a memory leak a script can drive.
  it('evicts expired buckets instead of growing without bound', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    for (let i = 0; i < 12_000; i += 1) limiter.consume(`key-${i}`, 0);
    expect(limiter.size()).toBe(12_000);

    // One write after the window has elapsed sweeps everything stale.
    limiter.consume('trigger', 5000);
    expect(limiter.size()).toBe(1);
  });

  it('reset drops every bucket', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.consume('k', 0);
    limiter.reset();

    expect(limiter.consume('k', 0).ok).toBe(true);
  });
});

describe('clientAddress', () => {
  /**
   * The LAST hop, not the first. Every proxy appends, so the last entry is what
   * our own reverse proxy observed and the earlier ones are whatever the client
   * chose to send. Reading the first would let a caller mint a fresh limiter
   * key per request by rotating a header — a limiter that does not limit.
   */
  it('takes the last hop of x-forwarded-for, which the client cannot forge', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(clientAddress(request)).toBe('10.0.0.1');
  });

  it('is unmoved by hops a caller prepends', () => {
    const spoofed = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'attacker-chose-this, 198.51.100.7' },
    });
    const alsoSpoofed = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'and-then-this, 198.51.100.7' },
    });
    expect(clientAddress(spoofed)).toBe(clientAddress(alsoSpoofed));
  });

  it('handles a single-hop header', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(clientAddress(request)).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip', () => {
    const request = new Request('http://localhost', { headers: { 'x-real-ip': '198.51.100.4' } });
    expect(clientAddress(request)).toBe('198.51.100.4');
  });

  // An unattributable request is still a request; one shared bucket for all of
  // them is the safer failure than treating them as unlimited.
  it('falls back to a single shared key when neither header is present', () => {
    expect(clientAddress(new Request('http://localhost'))).toBe('unknown');
  });
});
