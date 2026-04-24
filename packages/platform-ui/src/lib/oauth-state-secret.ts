/** Resolve the HMAC key used to sign/verify OAuth state tokens.
 *
 *  Prefers a dedicated `OAUTH_STATE_SECRET` so state-signing can be
 *  rotated independently of `PLATFORM_API_KEY`. Falls back to
 *  `PLATFORM_API_KEY` so existing deployments keep working without a
 *  secret migration. Returns `null` when neither is configured — the
 *  caller must surface a server-misconfiguration error.
 *
 *  Finding #7 from PR #263 review: avoid dual-using PLATFORM_API_KEY. */
export function getOAuthStateSecret(): string | null {
  const dedicated = process.env.OAUTH_STATE_SECRET;
  if (typeof dedicated === 'string' && dedicated.length > 0) return dedicated;
  const fallback = process.env.PLATFORM_API_KEY;
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return null;
}
