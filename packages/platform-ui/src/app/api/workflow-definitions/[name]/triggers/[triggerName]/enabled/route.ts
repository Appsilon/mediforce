import { createRouteAdapter } from '@/lib/route-adapter';
import { setTriggerEnabled } from '@mediforce/platform-api/handlers';
import {
  SetTriggerEnabledInputSchema,
  type SetTriggerEnabledInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string; triggerName: string }>;
}

/**
 * POST /api/workflow-definitions/:name/triggers/:triggerName/enabled
 * body: { namespace, enabled } — start/stop the trigger (ADR-0011).
 */
export const POST = createRouteAdapter<
  typeof SetTriggerEnabledInputSchema,
  SetTriggerEnabledInput,
  unknown,
  RouteContext
>(
  SetTriggerEnabledInputSchema,
  async (req, ctx) => {
    const { name, triggerName } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, definitionName: name, triggerName };
  },
  setTriggerEnabled,
);
