import { describe, it, expect } from 'vitest';
import { buildMagicLinkEmail } from '../magic-link-email';

describe('buildMagicLinkEmail', () => {
  const url = 'https://app.example.com/api/auth/callback/email?token=abc&email=you%40example.com';
  const senderName = 'Mediforce';

  it('uses the Mediforce sign-in subject', () => {
    expect(buildMagicLinkEmail(url, senderName).subject).toBe('Sign in to Mediforce');
  });

  it('includes the sign-in url in the plaintext and (html-escaped) in the html', () => {
    const { text, html } = buildMagicLinkEmail(url, senderName);
    expect(text).toContain(url);
    // The branded layout escapes the href, so `&` becomes `&amp;`.
    expect(html).toContain(url.replace(/&/g, '&amp;'));
  });

  it('mentions the 15-minute expiry', () => {
    const { text, html } = buildMagicLinkEmail(url, senderName);
    expect(text).toContain('15 minutes');
    expect(html).toContain('15 minutes');
  });

  it('renders the sender name in the branded header', () => {
    expect(buildMagicLinkEmail(url, senderName).html).toContain(senderName);
  });
});
