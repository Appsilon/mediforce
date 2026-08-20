import { createRouteAdapter } from '@/lib/route-adapter';
import { exportTriggers } from '@mediforce/platform-api/handlers';
import {
  ExportTriggersInputSchema,
  type ExportTriggersInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name/triggers/export?namespace=…
 * Export the workflow's triggers as a portable, instance-free file (Issue #933).
 */
export const GET = createRouteAdapter<
  typeof ExportTriggersInputSchema,
  ExportTriggersInput,
  unknown,
  RouteContext
>(
  ExportTriggersInputSchema,
  async (req, ctx) => ({
    definitionName: (await ctx.params).name,
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
  }),
  exportTriggers,
);
