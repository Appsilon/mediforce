/**
 * The magic-link sign-in email body (ADR-0002 §4). Pure so it is unit-testable
 * apart from the NextAuth `sendVerificationRequest` wiring in `auth.ts`. The
 * link validity (15 min) is set by the provider's `maxAge`; the copy here just
 * tells the recipient so.
 */
export function buildMagicLinkEmail(url: string): { subject: string; text: string; html: string } {
  const subject = 'Sign in to Mediforce';
  const text =
    `Sign in to Mediforce by opening this link:\n\n${url}\n\n` +
    `This link expires in 15 minutes. If you did not request it, you can ignore this email.`;
  const html =
    `<div style="font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5;">` +
    `<p>Sign in to Mediforce by opening this link:</p>` +
    `<p><a href="${url}">Sign in to Mediforce</a></p>` +
    `<p style="color: #666;">This link expires in 15 minutes. ` +
    `If you did not request it, you can ignore this email.</p>` +
    `</div>`;
  return { subject, text, html };
}
