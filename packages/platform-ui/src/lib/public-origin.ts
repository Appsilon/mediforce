import { getConfiguredAppBaseUrl } from './app-base-url';

/** Resolve the public origin (`scheme://host[:port]`) for absolute URLs the
 *  server emits — OAuth `redirect_uri`, post-callback redirects, etc.
 *
 *  Why not `new URL(request.url).origin`?
 *
 *  Next.js 15 in `output: 'standalone'` reconstructs `request.url` from the
 *  HTTP server's bound hostname (`HOSTNAME` env or `os.hostname()`), not from
 *  the inbound `Host` header. Behind Docker + reverse proxy this evaluates
 *  to the container hash (e.g. `e195cf41c355:3000`) rather than the public
 *  domain — the redirect_uri then mismatches the value registered on the
 *  OAuth provider, and the provider rejects the flow.
 *
 *  Resolution: prefer the env-configured base URL (via `getConfiguredAppBaseUrl`,
 *  which reads `APP_BASE_URL` then `NEXT_PUBLIC_APP_URL`). Fall back to
 *  `request.url.origin` only when neither is set — fine on local dev where
 *  there's no proxy hop. The `request` argument is unused in the env-set
 *  case; kept on the signature for that last-resort fallback.
 *
 *  No automatic `X-Forwarded-Host` / `X-Forwarded-Proto` detection — Next 15
 *  doesn't expose a trust-bound and auto-trusting opens header spoofing.
 *  Explicit env > implicit detection. */
export function publicOrigin(request: Request): string {
  return getConfiguredAppBaseUrl() ?? new URL(request.url).origin;
}
