import { createRouteAdapter } from '@/lib/route-adapter';
import { listTriggers, createTrigger } from '@mediforce/platform-api/handlers';
import {
  ListTriggersInputSchema,
  CreateTriggerInputSchema,
  type ListTriggersInput,
  type CreateTriggerInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name/triggers?namespace=…
 * List the Triggers attached to a workflow (ADR-0011; cron-only for now).
 */
export const GET = createRouteAdapter<
  typeof ListTriggersInputSchema,
  ListTriggersInput,
  unknown,
  RouteContext
>(
  ListTriggersInputSchema,
  async (req, ctx) => ({
    definitionName: (await ctx.params).name,
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
  }),
  listTriggers,
);

/**
 * POST /api/workflow-definitions/:name/triggers
 * body: { namespace, triggerName, type?, schedule, enabled? } — create (409 on conflict).
 */
export const POST = createRouteAdapter<
  typeof CreateTriggerInputSchema,
  CreateTriggerInput,
  unknown,
  RouteContext
>(
  CreateTriggerInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, definitionName: name };
  },
  createTrigger,
);
