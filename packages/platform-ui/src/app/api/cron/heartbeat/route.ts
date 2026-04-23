import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { heartbeat } from '@mediforce/platform-api/handlers';
import { HeartbeatInputSchema } from '@mediforce/platform-api/contract';
import { validateCronSchedule, isDue } from '@mediforce/workflow-engine';
import { triggerAutoRunner } from '@/lib/trigger-auto-runner';

/**
 * POST /api/cron/heartbeat
 *
 * Called by an external scheduler. Body is ignored — the handler scans for
 * workflow-definition cron triggers that are due and fires each.
 *
 * Race condition note: overlapping heartbeats can both see the same
 * `lastTriggeredAt` and both fire a given trigger. Not critical at current
 * scale (single VPS cron), but would need a transaction or distributed lock
 * to scale out.
 */
export const POST = createRouteAdapter(
  HeartbeatInputSchema,
  () => ({}),
  (input) => {
    const { processRepo, cronTrigger, cronTriggerStateRepo } = getPlatformServices();
    return heartbeat(input, {
      processRepo,
      cronTrigger,
      cronTriggerStateRepo,
      scheduleValidator: { validateCronSchedule, isDue },
      triggerRun: triggerAutoRunner,
    });
  },
);
