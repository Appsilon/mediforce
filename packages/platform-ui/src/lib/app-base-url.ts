/**
 * Public-facing base URL of this deployment.
 *
 * Used wherever the server emits an absolute URL: internal self-fetch
 * (auto-runner trigger, cron heartbeat, server actions) and OAuth flows
 * (`redirect_uri`, post-callback redirects).
 *
 * Why an explicit env var instead of deriving from `request.url`:
 * Next.js 15 in `output: 'standalone'` reconstructs `request.url` from the
 * HTTP server's bound hostname (`HOSTNAME` env or `os.hostname()`), not
 * from the inbound `Host` header. Behind Docker + reverse proxy that
 * resolves to the container hash (e.g. `e195cf41c355:3000`) — OAuth
 * providers then reject the redirect_uri as "not associated with this
 * application." Explicit env > implicit detection; same pattern as
 * Django's `USE_X_FORWARDED_HOST` / `SECURE_PROXY_SSL_HEADER` (opt-in,
 * to avoid header-spoofing risk).
 *
 * `getConfiguredAppBaseUrl` returns `undefined` when no env var is set
 * so OAuth callers can branch on it and fall back to `request.url.origin`
 * for local dev. `getAppBaseUrl` layers a `localhost:PORT` fallback for
 * internal self-fetch which always needs *some* URL.
 *
 * Empty-string env values are treated as unset (Docker compose's
 * `${VAR:-default}` can leave a literal empty string in the environment
 * when the host's `.env` declares the variable but doesn't assign it).
 * Using `||` (not `??`) handles both shapes uniformly.
 *
 * Stays in `platform-ui` because only the Next.js app needs it; the
 * `platform-api` handlers run in-process and never self-fetch.
 */
export function getConfiguredAppBaseUrl(): string | undefined {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!explicit) return undefined;
  try {
    return new URL(explicit).origin;
  } catch {
    return undefined;
  }
}

export function getAppBaseUrl(): string {
  return getConfiguredAppBaseUrl() ?? `http://localhost:${process.env.PORT ?? '3000'}`;
}

/** Public origin for absolute URLs the server emits to real clients — OAuth
 *  `redirect_uri`, post-callback redirects. Prefers the env-configured base
 *  URL; falls back to `request.url.origin` only on local dev where neither
 *  env var is set and there is no proxy hop.
 *
 *  The `request.url` fallback assumes Next.js always supplies a valid URL,
 *  which holds in practice — malformed request URLs are rejected by Node's
 *  HTTP parser before they reach a route handler. */
export function publicOrigin(request: Request): string {
  return getConfiguredAppBaseUrl() ?? new URL(request.url).origin;
}

/** Canonical OAuth callback URL for a given provider slug. All three OAuth
 *  route handlers (start, callback, oauth-discover) must send the provider
 *  to the same URL — centralised here so they can't drift. */
export function buildOAuthCallbackUrl(request: Request, providerSlug: string): string {
  return `${publicOrigin(request)}/api/oauth/${encodeURIComponent(providerSlug)}/callback`;
}
