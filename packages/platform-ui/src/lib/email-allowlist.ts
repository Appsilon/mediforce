/**
 * Deployment-level email-domain allowlist (ADR-0002 §4a). Pure so it is unit
 * testable in isolation from the NextAuth wiring in `auth.ts` (which builds a
 * DB pool at module load). Enforced in the NextAuth `signIn` callback across
 * every provider: with Google enabled, an unset allowlist would let any Google
 * account on earth sign in, so a deployment pins its domain(s) here.
 */
/**
 * Explicit, auditable opt-out (ADR-0002 §4a): setting `ALLOWED_EMAIL_DOMAINS`
 * to this sentinel deliberately allows ANY email domain to sign in. It must be
 * a chosen value — an empty/unset allowlist while OAuth is on still fails boot
 * (`validateEnv`), so no deployment disables the restriction by accident.
 */
export const ALLOW_ANY_DOMAIN = '*';

export function parseAllowedDomains(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
}

/**
 * True when the email may sign in: the `*` opt-out sentinel allows any domain,
 * an empty allowlist means no restriction, otherwise the email's domain must be
 * on the list (exact match).
 */
export function isEmailDomainAllowed(
  email: string | null | undefined,
  allowed: string[],
): boolean {
  if (allowed.includes(ALLOW_ANY_DOMAIN)) return true;
  if (allowed.length === 0) return true;
  const domain = (email ?? '').split('@')[1]?.toLowerCase() ?? '';
  return domain !== '' && allowed.includes(domain);
}
