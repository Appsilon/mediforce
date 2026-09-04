import { createRouteAdapter } from '@/lib/route-adapter';
import { getWorkflowAccess, setWorkflowAccess } from '@mediforce/platform-api/handlers';
import {
  GetWorkflowAccessInputSchema,
  SetWorkflowAccessInputSchema,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET  /api/workflow-definitions/:name/access?namespace=…
 * PUT  /api/workflow-definitions/:name/access?namespace=…  body: { access }
 *
 * Who may run and who may edit this workflow (ADR-0019). Readable by any
 * member of the workspace — it is where a member finds out why their Start
 * button is disabled — and writable by owner/admin only.
 */
export const GET = createRouteAdapter(
  GetWorkflowAccessInputSchema,
  async (req, ctx: RouteContext) => {
    const { name } = await ctx.params;
    return {
      name,
      namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
    };
  },
  getWorkflowAccess,
);

export const PUT = createRouteAdapter(
  SetWorkflowAccessInputSchema,
  async (req, ctx: RouteContext) => {
    const { name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      name,
      namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
    };
  },
  setWorkflowAccess,
);
