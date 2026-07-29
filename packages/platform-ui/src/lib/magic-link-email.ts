import { emailLayout, escapeHtml } from '@mediforce/platform-core';

/**
 * The magic-link sign-in email body (ADR-0002 §4). Pure so it is unit-testable
 * apart from the NextAuth `sendVerificationRequest` wiring in `auth.ts`. The
 * link validity (15 min) is set by the provider's `maxAge`; the copy here just
 * tells the recipient so. Rendered through the shared branded `emailLayout` so
 * it matches the invite / activation emails (header, teal button, footer).
 */
export function buildMagicLinkEmail(url: string, senderName: string): { subject: string; text: string; html: string } {
  const subject = 'Sign in to Mediforce';

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.3px">Sign in to Mediforce</p>
    <p style="margin:0 0 28px;font-size:15px;color:#71717a;line-height:1.5">
      Click below to sign in to your account. This link expires in 15 minutes.
    </p>
    <a href="${escapeHtml(url)}" style="display:block;text-align:center;background:#1c8879;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Sign in to Mediforce
    </a>`;

  const html = emailLayout(
    senderName,
    bodyHtml,
    'This sign-in link expires in 15 minutes. If you did not request it, you can safely ignore this email.',
  );

  const text =
    `Sign in to Mediforce by opening this link:\n\n${url}\n\n` +
    `This link expires in 15 minutes. If you did not request it, you can ignore this email.`;

  return { subject, text, html };
}
