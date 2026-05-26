import { createRouteAdapter } from '@/lib/route-adapter';
import { cronHeartbeat } from '@mediforce/platform-api/handlers';
import { HeartbeatInputSchema } from '@mediforce/platform-api/contract';
import type { HeartbeatInput } from '@mediforce/platform-api/contract';

/**
 * POST /api/cron/heartbeat
 *
 * System-actor only (apiKey). Scans every workflow for due cron triggers,
 * fires them, persists trigger state, and kicks the auto-runner. Skipped
 * triggers come back in the response body — they are not audited per
 * ADR-0005 §7 "emit only on state change" principle. Each fired trigger
 * emits `cron.trigger.fired` from inside the handler.
 */
export const POST = createRouteAdapter<
  typeof HeartbeatInputSchema,
  HeartbeatInput
>(
  HeartbeatInputSchema,
  () => ({}),
  cronHeartbeat,
);
