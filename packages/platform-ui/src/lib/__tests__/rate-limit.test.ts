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

  it('reset drops every bucket', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.consume('k', 0);
    limiter.reset();

    expect(limiter.consume('k', 0).ok).toBe(true);
  });
});

describe('clientAddress', () => {
  it('takes the first hop of x-forwarded-for', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
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
