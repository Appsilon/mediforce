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

/**
 * The sign-in authorization rule (ADR-0021 §5, amending ADR-0002 §4a).
 *
 * Two terms, and a reader should be able to find them in one place rather than
 * reconstruct them from three call sites:
 *
 *   - `domainAllowed` — `ALLOWED_EMAIL_DOMAINS` governs **self-service**
 *     sign-in. It is what stops any Google account on earth registering itself
 *     on a deployment, and removing a domain from it still evicts everyone who
 *     signed themselves in at that domain.
 *   - `invited` — `auth_users.invited_at`, stamped only by `seedInvite`. An
 *     admin's deliberate add (an invite, or a redeemed join link) is an
 *     authorization in its own right, and it was never the allowlist's job to
 *     overrule one. Before this, an admin could invite `alice@external.com` and
 *     every route she could reach rejected her.
 *
 * Note what this does NOT admit: an address whose `auth_users` row exists
 * merely because it once signed in. That is the whole reason the second term is
 * a column and not a row-existence check.
 */
export function isSignInAuthorized(params: {
  domainAllowed: boolean;
  invited: boolean;
}): boolean {
  return params.domainAllowed === true || params.invited === true;
}
