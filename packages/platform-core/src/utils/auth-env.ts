/**
 * `ENABLE_PASSWORD_AUTH` semantics in one place: password sign-in is ON unless
 * a deployment explicitly opts out with `false`, so a self-hosted estate gets
 * the invite / first-password flow without an extra env flip.
 *
 * Takes the raw value rather than reading `process.env` itself — three callers
 * in two packages (the login route, the boot-time provider check, the invite
 * flow's service wiring) share the rule without `platform-core` growing an
 * environment dependency.
 */
export function isPasswordAuthEnabled(rawEnvValue: string | undefined): boolean {
  return rawEnvValue !== 'false';
}

/**
 * One `AUTO_JOIN_WORKSPACES` pair: everyone whose verified email is at
 * `domain` becomes a `member` of `handle` on their next `GET /api/users/me`.
 */
export interface AutoJoinRule {
  readonly domain: string;
  readonly handle: string;
}

/**
 * Parse `AUTO_JOIN_WORKSPACES` — a CSV of `domain:handle` pairs, e.g.
 * `appsilon.com:appsilon,contoso.com:contoso`. Repeats are allowed on both
 * sides: several domains may feed one workspace, and one domain may feed
 * several workspaces.
 *
 * Deliberately separate from `ALLOWED_EMAIL_DOMAINS`, which answers a
 * different question — that one gates who may sign in at all, this one gates
 * where they land once signed in. A deployment commonly names the same domain
 * in both, but they are not the same decision and must stay independently
 * settable.
 *
 * Unset / empty yields `[]`, which is the feature being off (AGENTS.md §13:
 * deploying new code must need no per-deployment config change). A malformed
 * pair is skipped rather than thrown on, so one typo cannot stop a server that
 * would otherwise boot — an unconfigured workspace degrades to "nobody is
 * auto-joined", never a crash.
 */
export function parseAutoJoinWorkspaces(rawEnvValue: string | undefined): AutoJoinRule[] {
  return (rawEnvValue ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '')
    .map((pair) => {
      const [domain, handle, ...rest] = pair.split(':');
      if (rest.length > 0) return null;
      const normalizedDomain = (domain ?? '').trim().toLowerCase();
      const normalizedHandle = (handle ?? '').trim().toLowerCase();
      if (normalizedDomain === '' || normalizedHandle === '') return null;
      return { domain: normalizedDomain, handle: normalizedHandle };
    })
    .filter((rule): rule is AutoJoinRule => rule !== null);
}

/**
 * The workspaces `email` is auto-joined into. Empty when the address has no
 * domain or no rule names it.
 *
 * The wildcard `ALLOW_ANY_DOMAIN` sentinel that `ALLOWED_EMAIL_DOMAINS`
 * honours is NOT accepted here: "anyone who can sign in joins this workspace"
 * is a blast radius nobody should be able to configure by typo.
 */
export function autoJoinHandlesForEmail(
  email: string | null | undefined,
  rules: readonly AutoJoinRule[],
): string[] {
  const domain = (email ?? '').split('@')[1]?.toLowerCase() ?? '';
  if (domain === '') return [];
  return [...new Set(rules.filter((rule) => rule.domain === domain).map((rule) => rule.handle))];
}
