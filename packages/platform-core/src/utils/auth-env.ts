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
