import { createRouteAdapter } from '@/lib/route-adapter';
import { updateCronTrigger, deleteCronTrigger } from '@mediforce/platform-api/handlers';
import {
  UpdateCronTriggerInputSchema,
  DeleteCronTriggerInputSchema,
  type UpdateCronTriggerInput,
  type DeleteCronTriggerInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string; triggerName: string }>;
}

/**
 * PATCH /api/workflow-definitions/:name/cron-triggers/:triggerName
 * body: { namespace, schedule } — modify the live cadence (ADR-0010).
 */
export const PATCH = createRouteAdapter<
  typeof UpdateCronTriggerInputSchema,
  UpdateCronTriggerInput,
  unknown,
  RouteContext
>(
  UpdateCronTriggerInputSchema,
  async (req, ctx) => {
    const { name, triggerName } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, definitionName: name, triggerName };
  },
  updateCronTrigger,
);

/**
 * DELETE /api/workflow-definitions/:name/cron-triggers/:triggerName?namespace=…
 */
export const DELETE = createRouteAdapter<
  typeof DeleteCronTriggerInputSchema,
  DeleteCronTriggerInput,
  unknown,
  RouteContext
>(
  DeleteCronTriggerInputSchema,
  async (req, ctx) => {
    const { name, triggerName } = await ctx.params;
    return {
      definitionName: name,
      triggerName,
      namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
    };
  },
  deleteCronTrigger,
);
