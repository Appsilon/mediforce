import { createRouteAdapter } from '@/lib/route-adapter';
import { getWorkflowRunCount } from '@mediforce/platform-api/handlers';
import {
  GetWorkflowRunCountInputSchema,
  type GetWorkflowRunCountInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name/run-count?namespace=…
 *
 * Read companion for the delete-confirmation dialog — returns the current
 * count of associated runs so the UI can match it against
 * `expectedRunCount` before issuing DELETE.
 */
export const GET = createRouteAdapter<
  typeof GetWorkflowRunCountInputSchema,
  GetWorkflowRunCountInput,
  unknown,
  RouteContext
>(
  GetWorkflowRunCountInputSchema,
  async (req, ctx) => ({
    name: (await ctx.params).name,
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
  }),
  getWorkflowRunCount,
);
