import { createRouteAdapter } from '@/lib/route-adapter';
import { getStepSampleIo } from '@mediforce/platform-api/handlers';
import {
  GetStepSampleIoInputSchema,
  type GetStepSampleIoInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string; stepId: string }>;
}

/**
 * GET /api/workflow-definitions/:name/steps/:stepId/sample-io?namespace=…
 *
 * Read companion for the step editor's Data Flow panel — the real
 * input/output JSON this step produced the last time it completed, so
 * authors see actual field names instead of only the generic
 * `/output/*.json` contract description.
 */
export const GET = createRouteAdapter<
  typeof GetStepSampleIoInputSchema,
  GetStepSampleIoInput,
  unknown,
  RouteContext
>(
  GetStepSampleIoInputSchema,
  async (req, ctx) => {
    const { name, stepId } = await ctx.params;
    return {
      name,
      stepId,
      namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
    };
  },
  getStepSampleIo,
);
