import { createRouteAdapter } from '@/lib/route-adapter';
import { listCronTriggers, createCronTrigger } from '@mediforce/platform-api/handlers';
import {
  ListCronTriggersInputSchema,
  CreateCronTriggerInputSchema,
  type ListCronTriggersInput,
  type CreateCronTriggerInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name/cron-triggers?namespace=…
 * List the Cron Triggers attached to a workflow (ADR-0010).
 */
export const GET = createRouteAdapter<
  typeof ListCronTriggersInputSchema,
  ListCronTriggersInput,
  unknown,
  RouteContext
>(
  ListCronTriggersInputSchema,
  async (req, ctx) => ({
    definitionName: (await ctx.params).name,
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
  }),
  listCronTriggers,
);

/**
 * POST /api/workflow-definitions/:name/cron-triggers
 * body: { namespace, triggerName, schedule, enabled? } — create (409 on conflict).
 */
export const POST = createRouteAdapter<
  typeof CreateCronTriggerInputSchema,
  CreateCronTriggerInput,
  unknown,
  RouteContext
>(
  CreateCronTriggerInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, definitionName: name };
  },
  createCronTrigger,
);
