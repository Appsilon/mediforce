/**
 * Base URL for internal server-to-server calls (auto-runner trigger, cron
 * heartbeat, server-action self-fetch). Next.js-specific — reads
 * `NEXT_PUBLIC_APP_URL`, falls back to localhost with `PORT`.
 *
 * Stays in `platform-ui` because only the Next.js app needs it; `platform-api`
 * handlers run in-process and never self-fetch.
 */
export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
}
