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
 *  Resolution order:
 *    1. `APP_BASE_URL`        — explicit server-side public URL
 *    2. `NEXT_PUBLIC_APP_URL` — same value bundled into client (we accept it
 *                               here as a fallback so deployments that already
 *                               set the public variant work without a second
 *                               env var)
 *    3. `request.url.origin`  — last-resort fallback, fine on local dev where
 *                               there's no proxy hop
 *
 *  No automatic detection from `X-Forwarded-Host` / `X-Forwarded-Proto` — that
 *  path is risky (header spoofing) and Next 15 doesn't expose a built-in
 *  trust-bound for it. Explicit > magical. */
export function publicOrigin(request: Request): string {
  const candidate = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (candidate !== undefined && candidate !== '') {
    try {
      return new URL(candidate).origin;
    } catch {
      // Fall through to request-based default. The misconfiguration is
      // surfaced in logs by the consumer (e.g. wrong redirect_uri).
    }
  }
  return new URL(request.url).origin;
}
