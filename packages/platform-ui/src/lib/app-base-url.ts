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
