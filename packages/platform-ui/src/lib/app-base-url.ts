/**
 * Public-facing base URL of this deployment. Used wherever the server has to
 * emit an absolute URL: server-to-server self-fetch (auto-runner trigger,
 * cron heartbeat, server-action self-fetch) and OAuth `redirect_uri` /
 * post-callback redirects.
 *
 * `getConfiguredAppBaseUrl` returns the env-supplied value or `undefined` so
 * callers that need to detect "no explicit config" (e.g. OAuth flows that
 * prefer the inbound request as a last-resort fallback) can branch on it.
 *
 * `getAppBaseUrl` adds a `localhost:PORT` fallback so internal self-fetch
 * always has *some* URL to hit during local dev.
 *
 * Empty-string env values are treated the same as unset — Docker compose's
 * `${VAR:-default}` interpolation can leave a literal empty string when the
 * host's `.env` defines the variable but doesn't assign it. Using `||`
 * (not `??`) handles both shapes uniformly.
 *
 * Stays in `platform-ui` because only the Next.js app needs it; `platform-api`
 * handlers run in-process and never self-fetch.
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
