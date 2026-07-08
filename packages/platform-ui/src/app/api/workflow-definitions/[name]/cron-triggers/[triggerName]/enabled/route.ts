import { createRouteAdapter } from '@/lib/route-adapter';
import { setCronTriggerEnabled } from '@mediforce/platform-api/handlers';
import {
  SetCronTriggerEnabledInputSchema,
  type SetCronTriggerEnabledInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string; triggerName: string }>;
}

/**
 * POST /api/workflow-definitions/:name/cron-triggers/:triggerName/enabled
 * body: { namespace, enabled } — start/stop the trigger (ADR-0010).
 */
export const POST = createRouteAdapter<
  typeof SetCronTriggerEnabledInputSchema,
  SetCronTriggerEnabledInput,
  unknown,
  RouteContext
>(
  SetCronTriggerEnabledInputSchema,
  async (req, ctx) => {
    const { name, triggerName } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, definitionName: name, triggerName };
  },
  setCronTriggerEnabled,
);
