import { createRouteAdapter } from '@/lib/route-adapter';
import { setDefaultWorkflowVersion } from '@mediforce/platform-api/handlers';
import {
  SetDefaultVersionInputSchema,
  type SetDefaultVersionInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * POST /api/workflow-definitions/:name/default-version
 * body: { namespace, version }
 */
export const POST = createRouteAdapter<
  typeof SetDefaultVersionInputSchema,
  SetDefaultVersionInput,
  unknown,
  RouteContext
>(
  SetDefaultVersionInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, name };
  },
  setDefaultWorkflowVersion,
);
