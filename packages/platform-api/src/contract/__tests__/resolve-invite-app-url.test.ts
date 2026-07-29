import { describe, it, expect } from 'vitest';
import { resolveInviteAppUrl } from '../config';

describe('resolveInviteAppUrl', () => {
  it('uses APP_BASE_URL when set', () => {
    expect(resolveInviteAppUrl({ APP_BASE_URL: 'https://host.example' })).toBe(
      'https://host.example',
    );
  });

  it('falls through an empty-string APP_BASE_URL to NEXT_PUBLIC_APP_URL', () => {
    expect(
      resolveInviteAppUrl({ APP_BASE_URL: '', NEXT_PUBLIC_APP_URL: 'https://next.example' }),
    ).toBe('https://next.example');
  });

  it('strips a trailing slash so links never double up (no https://host//login)', () => {
    expect(resolveInviteAppUrl({ APP_BASE_URL: 'https://host.example/' })).toBe(
      'https://host.example',
    );
  });

  it('prefers APP_BASE_URL over NEXT_PUBLIC_APP_URL', () => {
    expect(
      resolveInviteAppUrl({
        APP_BASE_URL: 'https://primary.example',
        NEXT_PUBLIC_APP_URL: 'https://secondary.example',
      }),
    ).toBe('https://primary.example');
  });

  it('falls back to localhost:PORT when neither var is set', () => {
    expect(resolveInviteAppUrl({ PORT: '9003' })).toBe('http://localhost:9003');
  });

  it('defaults the port to 3000 when PORT is unset', () => {
    expect(resolveInviteAppUrl({})).toBe('http://localhost:3000');
  });
});
