import { getAppBaseUrl } from './app-base-url.js';

/**
 * Fire-and-forget trigger for the auto-runner loop (`POST /api/processes/:id/run`).
 *
 * Used by handlers (task complete/resolve, process create/resume, cron
 * heartbeat) to kick downstream agent steps after a state change. The actual
 * `/run` endpoint still lives as an inline Next.js route (Phase 3 migration),
 * so this helper stays Next.js-flavoured: it reads `NEXT_PUBLIC_APP_URL` and
 * authenticates with `X-Api-Key`.
 *
 * Errors don't propagate (the caller has already committed the state change
 * and the auto-runner is best effort) but they ARE logged. Otherwise a
 * misconfigured `PLATFORM_API_KEY` produces a healthy-looking deploy where
 * agent steps silently never fire — the exact failure mode we hit pre-Phase 1.
 */
export function triggerAutoRunner(instanceId: string, triggeredBy: string): void {
  const appUrl = getAppBaseUrl();
  void fetch(`${appUrl}/api/processes/${instanceId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
    },
    body: JSON.stringify({ triggeredBy }),
  }).catch((err) => {
    console.error(
      `[trigger-auto-runner] Failed to trigger /run for ${instanceId}:`,
      err,
    );
  });
}
