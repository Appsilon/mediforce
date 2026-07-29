import { describe, it, expect } from 'vitest';
import { buildMagicLinkEmail } from '../magic-link-email';

describe('buildMagicLinkEmail', () => {
  const url = 'https://app.example.com/api/auth/callback/email?token=abc&email=you%40example.com';

  it('uses the Mediforce sign-in subject', () => {
    expect(buildMagicLinkEmail(url).subject).toBe('Sign in to Mediforce');
  });

  it('includes the sign-in url in both text and html', () => {
    const { text, html } = buildMagicLinkEmail(url);
    expect(text).toContain(url);
    expect(html).toContain(url);
  });

  it('mentions the 15-minute expiry', () => {
    const { text, html } = buildMagicLinkEmail(url);
    expect(text).toContain('15 minutes');
    expect(html).toContain('15 minutes');
  });
});
