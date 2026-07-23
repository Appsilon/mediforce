import { describe, it, expect } from 'vitest';
import { getSessionCookie, getSessionCookieFromHeader } from '../session-cookie';

describe('getSessionCookie (cookie jar)', () => {
  const jar = (map: Record<string, string>) => ({
    get: (name: string) => (name in map ? { value: map[name]! } : undefined),
  });

  it('reads the non-secure cookie', () => {
    expect(getSessionCookie(jar({ 'authjs.session-token': 'tok' }))).toBe('tok');
  });

  it('prefers the __Secure- cookie when present', () => {
    expect(
      getSessionCookie(jar({ '__Secure-authjs.session-token': 'secure', 'authjs.session-token': 'plain' })),
    ).toBe('secure');
  });

  it('returns null when neither cookie is set', () => {
    expect(getSessionCookie(jar({ other: 'x' }))).toBeNull();
  });

  it('treats an empty cookie value as absent', () => {
    expect(getSessionCookie(jar({ 'authjs.session-token': '' }))).toBeNull();
  });
});

describe('getSessionCookieFromHeader (raw header)', () => {
  it('extracts the token from a multi-cookie header', () => {
    expect(
      getSessionCookieFromHeader('theme=dark; authjs.session-token=abc123; other=1'),
    ).toBe('abc123');
  });

  it('URL-decodes the value', () => {
    expect(getSessionCookieFromHeader('authjs.session-token=a%20b')).toBe('a b');
  });

  it('prefers the __Secure- cookie', () => {
    expect(
      getSessionCookieFromHeader('authjs.session-token=plain; __Secure-authjs.session-token=secure'),
    ).toBe('secure');
  });

  it('returns null for a missing or empty header', () => {
    expect(getSessionCookieFromHeader(null)).toBeNull();
    expect(getSessionCookieFromHeader('')).toBeNull();
    expect(getSessionCookieFromHeader('unrelated=1')).toBeNull();
  });
});
