/**
 * Deployment-level email-domain allowlist (ADR-0002 §4a). Pure so it is unit
 * testable in isolation from the NextAuth wiring in `auth.ts` (which builds a
 * DB pool at module load). Enforced in the NextAuth `signIn` callback across
 * every provider: with Google enabled, an unset allowlist would let any Google
 * account on earth sign in, so a deployment pins its domain(s) here.
 */
export function parseAllowedDomains(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
}

/**
 * True when the email may sign in: either no allowlist is configured (empty
 * list = no restriction) or the email's domain is on the list.
 */
export function isEmailDomainAllowed(
  email: string | null | undefined,
  allowed: string[],
): boolean {
  if (allowed.length === 0) return true;
  const domain = (email ?? '').split('@')[1]?.toLowerCase() ?? '';
  return domain !== '' && allowed.includes(domain);
}
