/**
 * Whether a magic-link sign-in email should actually be sent (ADR-0002 §4).
 *
 * Pure so it is unit-testable apart from the NextAuth `sendVerificationRequest`
 * wiring. The Email provider would otherwise let ANY address request a link and
 * the adapter would self-register a new `auth_users` row on callback; a link is
 * sent only when the address already belongs to a user AND its domain is
 * allowlisted. Callers stay silent (no send, no throw) otherwise, so the UI
 * shows the same "check your email" either way (anti-enumeration).
 */
export function shouldSendMagicLink(params: { userExists: boolean; domainAllowed: boolean }): boolean {
  return params.userExists === true && params.domainAllowed === true;
}
