import { createRouteAdapter } from '@/lib/route-adapter';
import { planWorkflowBuild } from '@mediforce/platform-api/handlers';
import { PlanWorkflowBuildInputSchema, type PlanWorkflowBuildInput } from '@mediforce/platform-api/contract';
import { z } from 'zod';

const PlanScopedSchema = PlanWorkflowBuildInputSchema.extend({
  namespace: z.string().min(1),
});

/**
 * POST /api/workflow-assistant/plan?namespace=…
 *
 * The turn before the build: what the assistant intends to do, what it needs to
 * ask first, and the phases the pane shows while the build runs. Separate from
 * the build itself because a plan that arrives with the result arrives too late
 * to correct.
 */
export const POST = createRouteAdapter<
  typeof PlanScopedSchema,
  PlanWorkflowBuildInput & { namespace: string }
>(
  PlanScopedSchema,
  async (req) => {
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, namespace: namespace ?? undefined };
  },
  planWorkflowBuild,
);
