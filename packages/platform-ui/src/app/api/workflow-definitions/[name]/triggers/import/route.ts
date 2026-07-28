import { createRouteAdapter } from '@/lib/route-adapter';
import { importTriggers } from '@mediforce/platform-api/handlers';
import {
  ImportTriggersInputSchema,
  type ImportTriggersInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * POST /api/workflow-definitions/:name/triggers/import
 * body: { namespace, triggers, replace? } — materialize a portable trigger file
 * into this workflow (Issue #933). Webhook URLs re-derive for this host and
 * cron cursors anchor to `now`.
 */
export const POST = createRouteAdapter<
  typeof ImportTriggersInputSchema,
  ImportTriggersInput,
  unknown,
  RouteContext
>(
  ImportTriggersInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, definitionName: name };
  },
  importTriggers,
);
