import { createRouteAdapter } from '@/lib/route-adapter';
import { updateTrigger, deleteTrigger } from '@mediforce/platform-api/handlers';
import {
  UpdateTriggerInputSchema,
  DeleteTriggerInputSchema,
  type UpdateTriggerInput,
  type DeleteTriggerInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string; triggerName: string }>;
}

/**
 * PATCH /api/workflow-definitions/:name/triggers/:triggerName
 * body: { namespace, schedule } — modify the live cadence (ADR-0011).
 */
export const PATCH = createRouteAdapter<
  typeof UpdateTriggerInputSchema,
  UpdateTriggerInput,
  unknown,
  RouteContext
>(
  UpdateTriggerInputSchema,
  async (req, ctx) => {
    const { name, triggerName } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, definitionName: name, triggerName };
  },
  updateTrigger,
);

/**
 * DELETE /api/workflow-definitions/:name/triggers/:triggerName?namespace=…
 */
export const DELETE = createRouteAdapter<
  typeof DeleteTriggerInputSchema,
  DeleteTriggerInput,
  unknown,
  RouteContext
>(
  DeleteTriggerInputSchema,
  async (req, ctx) => {
    const { name, triggerName } = await ctx.params;
    return {
      definitionName: name,
      triggerName,
      namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
    };
  },
  deleteTrigger,
);
